// Messmonitor Drehstrom: Messwerte live auswerten wie ein Netzanalysator
// Quellen: Simulation (Standard), Messdatei (CSV), HTTP/JSON (Gerät oder Gateway), Modbus TCP über Gateway (Vorlage)
// Alles läuft im Browser. Einstellungen bleiben nur im eigenen Browser gespeichert.
'use strict';

const SPEICHER = 'messmonitor-v1';
const TAKT_MS = 500;
const PUFFER = 240;          // 2 Minuten bei 0,5 s
const U_NENN = 230;

// ---------- Komplexe Zahlen für die Zeigerrechnung ----------
const C = (re, im) => ({ re, im });
const polar = (r, grad) => C(r * Math.cos(grad * Math.PI / 180), r * Math.sin(grad * Math.PI / 180));
const plus = (a, b) => C(a.re + b.re, a.im + b.im);
const minus = (a, b) => C(a.re - b.re, a.im - b.im);
const mal = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const betrag = a => Math.hypot(a.re, a.im);
const A1 = polar(1, 120), A2 = polar(1, 240);   // Drehoperator a und a²

// ---------- Helfer ----------
const $ = q => document.querySelector(q);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const z = (x, n = 1) => Number.isFinite(x) ? x.toLocaleString('de-DE', { minimumFractionDigits: n, maximumFractionDigits: n }) : '-';
const lesen = v => { if (v === null || v === undefined || String(v).trim() === '') return NaN; return Number(String(v).replace(',', '.')); };
const begrenzt = (x, a, b) => Math.min(b, Math.max(a, x));
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('zeigen'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('zeigen'), 3500); }
function speichern() { try { localStorage.setItem(SPEICHER, JSON.stringify({ cfg, sim })); } catch (e) { /* egal */ } }
function holen() { try { return JSON.parse(localStorage.getItem(SPEICHER)) || {}; } catch (e) { return {}; } }

// ---------- Szenarien: jedes erklärt ein typisches Bild aus der Praxis ----------
const SZENARIEN = {
  normal: { titel: 'Normalbetrieb', u: [230, 231, 229], i: [14.2, 14.5, 14.3], cos: [0.86, 0.86, 0.86], f: 50, drehfeld: 'rechts',
    text: 'Drehstrommotor 7,5 kW, Bemessungsstrom 15,2 A, unter Last. Spannungen und Ströme sind nahezu gleich, der Neutralleiter führt kaum Strom.' },
  schieflast: { titel: 'Schieflast', u: [231, 227, 229], i: [14.6, 4.4, 8.8], cos: [0.97, 0.95, 0.9], f: 50, drehfeld: 'rechts',
    text: 'Einphasige Verbraucher sind ungleich auf die Außenleiter verteilt. Die Ströme unterscheiden sich stark, im Neutralleiter fließt der Ausgleichsstrom.' },
  phasenausfall: { titel: 'Phasenausfall L3', u: [230, 231, 0], i: [24.6, 24.9, 0], cos: [0.72, 0.72, 0], f: 50, drehfeld: 'rechts',
    text: 'L3 fehlt, zum Beispiel durch eine ausgelöste Sicherung. Ein laufender Motor dreht auf zwei Phasen weiter, zieht deutlich mehr Strom und wird heiß. Der Motorschutz muss auslösen.' },
  linksdrehfeld: { titel: 'Linksdrehfeld', u: [230, 231, 229], i: [14.2, 14.5, 14.3], cos: [0.86, 0.86, 0.86], f: 50, drehfeld: 'links',
    text: 'Zwei Außenleiter sind vertauscht. Die Werte sehen normal aus, aber Motoren drehen falsch herum: Pumpen fördern nicht, Lüfter blasen in die falsche Richtung.' },
  ueberlast: { titel: 'Überlast', u: [228, 229, 227], i: [19.6, 19.9, 19.7], cos: [0.88, 0.88, 0.88], f: 50, drehfeld: 'rechts',
    text: 'Der Motor ist mechanisch überlastet, zum Beispiel durch ein schwergängiges Lager oder ein blockiertes Förderband. Der Strom liegt über dem Nennstrom.' },
  unterspannung: { titel: 'Unterspannung', u: [201, 203, 200], i: [16.1, 16.3, 16.0], cos: [0.86, 0.86, 0.86], f: 50, drehfeld: 'rechts',
    text: 'Die Spannung liegt unter 207 V, zum Beispiel durch eine zu lange oder zu dünne Zuleitung. Bei gleicher Last steigt der Motorstrom.' },
  teillast: { titel: 'Teillast, schlechter cos φ', u: [231, 231, 230], i: [7.8, 7.9, 7.8], cos: [0.42, 0.42, 0.42], f: 50, drehfeld: 'rechts',
    text: 'Ein Motor im Leerlauf oder in Teillast nimmt viel Blindleistung auf. Der cos φ sinkt, das Netz wird mit Blindstrom belastet. Abhilfe: Motor passend dimensionieren oder kompensieren.' },
  frequenz: { titel: 'Frequenzabweichung', u: [229, 230, 229], i: [14.0, 14.2, 14.1], cos: [0.86, 0.86, 0.86], f: 49.2, drehfeld: 'rechts',
    text: 'Im Verbundnetz bleibt die Frequenz sehr genau bei 50 Hz. Größere Abweichungen kommen im Inselbetrieb vor, zum Beispiel an einem Notstromaggregat. Die Drehzahl der Motoren ändert sich mit.' }
};

// ---------- Vorlagen für Messgeräte ----------
const SDM630 = [
  ['U L1-N', '30001', 'V'], ['U L2-N', '30003', 'V'], ['U L3-N', '30005', 'V'],
  ['I L1', '30007', 'A'], ['I L2', '30009', 'A'], ['I L3', '30011', 'A'],
  ['P L1', '30013', 'W'], ['P L2', '30015', 'W'], ['P L3', '30017', 'W'],
  ['cos φ L1', '30031', ''], ['cos φ L2', '30033', ''], ['cos φ L3', '30035', ''],
  ['Frequenz', '30071', 'Hz'], ['I N', '30225', 'A']
];
const HTTP_FELDER = [['u1', 'U L1'], ['u2', 'U L2'], ['u3', 'U L3'], ['i1', 'I L1'], ['i2', 'I L2'], ['i3', 'I L3'], ['cos1', 'cos φ L1'], ['cos2', 'cos φ L2'], ['cos3', 'cos φ L3'], ['f', 'Frequenz']];
const HTTP_VORLAGEN = {
  shelly: { name: 'Shelly Pro 3EM (lokale API)', url: 'http://IP-ADRESSE/rpc/EM.GetStatus?id=0',
    map: { u1: 'a_voltage', u2: 'b_voltage', u3: 'c_voltage', i1: 'a_current', i2: 'b_current', i3: 'c_current', cos1: 'a_pf', cos2: 'b_pf', cos3: 'c_pf', f: 'a_freq' } },
  gateway: { name: 'Eigenes Gateway (JSON)', url: 'https://gateway.example/messwerte',
    map: { u1: 'u.l1', u2: 'u.l2', u3: 'u.l3', i1: 'i.l1', i2: 'i.l2', i3: 'i.l3', cos1: 'cos.l1', cos2: 'cos.l2', cos3: 'cos.l3', f: 'f' } }
};

// ---------- Zustand ----------
const gespeichert = holen();
let cfg = Object.assign({ quelle: 'sim', inenn: 15.2, http: { vorlage: 'gateway', url: HTTP_VORLAGEN.gateway.url, intervall: 2, map: { ...HTTP_VORLAGEN.gateway.map } },
  modbus: { ip: '192.168.0.50', port: 502, unit: 1, wandler: 1 } }, gespeichert.cfg || {});
let sim = Object.assign({ szenario: 'normal', ...SZENARIEN.normal, last: 'ind', rauschen: 1 }, gespeichert.sim || {});
let datei = null;            // { zeilen: [...], pos, name }
let http = { letzte: null, fehler: '', zeit: 0, laeuft: false };
let verlauf = [];
let aufzeichnung = null;     // [] wenn aktiv
let geraetOffen = false;

// ---------- Messwert holen ----------
function rauschen(x, prozent) { return x === 0 ? 0 : x * (1 + (Math.random() - 0.5) * 2 * prozent / 100); }
function probeSimulation() {
  const r = Number(sim.rauschen) || 0;
  return {
    u: sim.u.map(x => rauschen(Number(x) || 0, r * 0.3)), i: sim.i.map(x => Math.max(0, rauschen(Number(x) || 0, r))),
    cos: sim.cos.map(x => begrenzt(rauschen(Number(x) || 0, r * 0.2), 0, 1)), ind: sim.last !== 'kap',
    f: rauschen(Number(sim.f) || 50, 0.02), drehfeld: sim.drehfeld, quelle: 'Simulation'
  };
}
function probeDatei() {
  const zl = datei.zeilen[datei.pos];
  datei.pos = (datei.pos + 1) % datei.zeilen.length;
  return { ...zl, ind: true, quelle: `Messdatei ${datei.name} (${datei.pos}/${datei.zeilen.length})` };
}
function pfad(obj, p) { return String(p || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj); }
async function httpAbfragen() {
  if (http.laeuft) return;
  http.laeuft = true;
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(cfg.http.url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) throw new Error('Antwort ' + r.status);
    const j = await r.json(), m = cfg.http.map, w = k => Math.abs(lesen(pfad(j, m[k])));
    const probe = { u: [w('u1'), w('u2'), w('u3')], i: [w('i1'), w('i2'), w('i3')], cos: [w('cos1'), w('cos2'), w('cos3')], f: w('f'), ind: true, drehfeld: 'unbekannt', quelle: 'HTTP ' + new URL(cfg.http.url).host };
    if (probe.u.some(x => !Number.isFinite(x)) || probe.i.some(x => !Number.isFinite(x))) throw new Error('Spannung oder Strom fehlt in der Antwort. Zuordnung der Felder prüfen.');
    probe.cos = probe.cos.map(x => Number.isFinite(x) ? begrenzt(x, 0, 1) : 1);
    http = { ...http, letzte: probe, fehler: '', zeit: Date.now() };
  } catch (e) {
    const gemischt = location.protocol === 'https:' && /^http:/i.test(cfg.http.url);
    http = { ...http, fehler: gemischt ? 'Der Browser blockiert unverschlüsselte Adressen (http) auf einer https-Seite. Das Gateway muss https anbieten.'
      : e.name === 'AbortError' ? 'Keine Antwort innerhalb von 4 Sekunden.'
      : e.message === 'Failed to fetch' ? 'Nicht erreichbar oder vom Browser blockiert (CORS). Das Gerät oder Gateway muss Zugriffe von dieser Seite erlauben.' : e.message };
  } finally { http.laeuft = false; }
}

// ---------- Auswertung ----------
function rechnen(p) {
  const winkel = p.drehfeld === 'links' ? [90, 210, -30] : [90, -30, 210];
  const phi = p.cos.map(c => Math.acos(begrenzt(c, 0, 1)) * 180 / Math.PI * (p.ind ? 1 : -1));
  const U = p.u.map((u, k) => polar(u, winkel[k]));
  const I = p.i.map((i, k) => polar(i, winkel[k] - phi[k]));
  const ull = [betrag(minus(U[0], U[1])), betrag(minus(U[1], U[2])), betrag(minus(U[2], U[0]))];
  const P = p.u.map((u, k) => u * p.i[k] * p.cos[k] / 1000);
  const Q = p.u.map((u, k) => u * p.i[k] * Math.sin(phi[k] * Math.PI / 180) / 1000);
  const S = p.u.map((u, k) => u * p.i[k] / 1000);
  const Pg = P.reduce((a, b) => a + b, 0), Qg = Q.reduce((a, b) => a + b, 0), Sg = Math.hypot(Pg, Qg);
  const iN = betrag(I.reduce(plus, C(0, 0)));
  const mit = plus(plus(U[0], mal(A1, U[1])), mal(A2, U[2])), gegen = plus(plus(U[0], mal(A2, U[1])), mal(A1, U[2]));
  const u1 = betrag(mit) / 3, u2 = betrag(gegen) / 3;
  const ausfall = p.u.map(u => u < 50);
  let drehfeld = p.drehfeld === 'unbekannt' ? 'unbekannt' : ausfall.some(Boolean) ? 'kein' : u1 >= u2 ? 'rechts' : 'links';
  const unsym = u1 > 1 && !ausfall.some(Boolean) ? Math.min(u1, u2) / Math.max(u1, u2) * 100 : NaN;
  return { ...p, winkel, phi, U, I, ull, P, Q, S, Pg, Qg, Sg, cosg: Sg > 0.01 ? Pg / Sg : NaN, iN, unsym, ausfall, drehfeld };
}

function bewerten(m) {
  const b = [], ein = (stufe, titel, text, quelle) => b.push({ stufe, titel, text, quelle });
  const ph = ['L1', 'L2', 'L3'];
  const fehlt = ph.filter((_, k) => m.ausfall[k]);
  if (fehlt.length === 3) { ein('rot', 'Keine Spannung', 'An keinem Außenleiter liegt Spannung an.', ''); return b; }
  if (fehlt.length) ein('rot', `Phasenausfall ${fehlt.join(', ')}`, 'Drehstromverbraucher nicht weiter betreiben. Sicherung, Klemmen und Zuleitung prüfen.', 'Spannung unter 50 V');
  const ausser = ph.filter((_, k) => !m.ausfall[k] && (m.u[k] < 207 || m.u[k] > 253));
  if (ausser.length) ein('warn', `Spannung außerhalb 230 V ±10 % (${ausser.join(', ')})`, ausser.map(p => `${p}: ${z(m.u[ph.indexOf(p)], 0)} V`).join(', ') + '. Zuleitung, Spannungsfall und Netz prüfen.', 'DIN EN 50160: 207 bis 253 V');
  else if (!fehlt.length) ein('ok', 'Spannung im Band', 'Alle Außenleiter zwischen 207 und 253 V.', 'DIN EN 50160');
  if (m.f < 47 || m.f > 52) ein('rot', `Frequenz ${z(m.f, 2)} Hz`, 'Weit außerhalb des zulässigen Bereichs.', 'DIN EN 50160: immer 47 bis 52 Hz');
  else if (m.f < 49.5 || m.f > 50.5) ein('warn', `Frequenz ${z(m.f, 2)} Hz`, 'Außerhalb 50 Hz ±1 %. Typisch für Inselbetrieb oder Aggregat. Drehzahlen ändern sich mit.', 'DIN EN 50160: 49,5 bis 50,5 Hz');
  else ein('ok', `Frequenz ${z(m.f, 2)} Hz`, 'Innerhalb 50 Hz ±1 %.', 'DIN EN 50160');
  if (m.drehfeld === 'links') ein('rot', 'Linksdrehfeld', 'Motoren drehen falsch herum. Zwei Außenleiter tauschen, danach Drehrichtung prüfen.', 'Gegensystem größer als Mitsystem');
  else if (m.drehfeld === 'rechts') ein('ok', 'Rechtsdrehfeld', 'Phasenfolge L1, L2, L3 richtig.', 'Mitsystem größer als Gegensystem');
  else if (m.drehfeld === 'unbekannt') ein('warn', 'Drehfeld nicht übertragen', 'Das Messgerät liefert keine Phasenwinkel. Drehfeld vor Ort mit Drehfeldmessgerät prüfen.', '');
  if (Number.isFinite(m.unsym) && m.drehfeld !== 'links') {
    if (m.unsym > 2) ein('warn', `Spannungsunsymmetrie ${z(m.unsym, 1)} %`, 'Unsymmetrische Spannungen erwärmen Motoren zusätzlich. Ursache oft Schieflast im Netz.', 'DIN EN 50160: höchstens 2 %');
    else ein('ok', `Spannungsunsymmetrie ${z(m.unsym, 2)} %`, 'Verhältnis Gegensystem zu Mitsystem.', 'DIN EN 50160: höchstens 2 %');
  }
  const imax = Math.max(...m.i), imin = Math.min(...m.i.filter((_, k) => !m.ausfall[k])), imit = m.i.reduce((a, c) => a + c, 0) / 3;
  const inenn = Number(cfg.inenn) || 0;
  if (imax < 0.05) ein('ok', 'Kein Strom', 'Kein Verbraucher eingeschaltet.', '');
  else {
    if (inenn > 0 && imax > inenn) ein('rot', `Überlast: ${z(imax, 1)} A bei ${z(inenn, 1)} A Nennstrom`, 'Ursache suchen: Mechanik schwergängig, Lager, Unterspannung oder Phasenausfall. Motorschutz muss auslösen.', 'Bemessungsstrom des Verbrauchers');
    else if (inenn > 0) ein('ok', `Auslastung ${z(imax / inenn * 100, 0)} %`, `Höchster Außenleiterstrom ${z(imax, 1)} A.`, 'Bemessungsstrom des Verbrauchers');
    if (!fehlt.length && imit > 0.5 && (imax - imin) / imit > 0.1) ein('warn', `Schieflast ${z((imax - imin) / imit * 100, 0)} %`, `Neutralleiterstrom ${z(m.iN, 1)} A. Einphasige Verbraucher gleichmäßiger verteilen.`, 'Abweichung der Ströme über 10 %');
    if (Number.isFinite(m.cosg) && m.Pg > 0.2) {
      if (m.cosg < 0.8) ein('warn', `cos φ ${z(m.cosg, 2)}`, `Blindleistung ${z(Math.abs(m.Qg), 2)} kvar. Typisch für Motoren im Leerlauf oder in Teillast. Verbraucher passend auslegen oder kompensieren.`, 'Motoren unter Last meist 0,8 bis 0,9');
      else if (m.cosg < 0.9) ein('ok', `cos φ ${z(m.cosg, 2)}`, 'Für einen Motor unter Last üblich. Für die gesamte Anlage verlangen Netzbetreiber meist mindestens 0,9, sonst wird Blindarbeit berechnet.', 'Zielwert der Anlage ab 0,9');
      else ein('ok', `cos φ ${z(m.cosg, 2)}`, 'Wenig Blindleistung.', 'Zielwert der Anlage ab 0,9');
    }
  }
  return b;
}

// ---------- Darstellung ----------
const FARBE = ['var(--l1)', 'var(--l2)', 'var(--l3)'];
function zeichneKopf(m, b) {
  const schlecht = b.some(x => x.stufe === 'rot'), warn = b.some(x => x.stufe === 'warn');
  const df = { rechts: ['Rechts', 'ok'], links: ['Links', 'rot'], kein: ['Kein', 'rot'], unbekannt: ['?', 'warn'] }[m.drehfeld];
  $('#kopfwerte').innerHTML = `
    <div class="kw"><span>Wirkleistung</span><b>${z(m.Pg, 2)} kW</b><small>Blind ${z(m.Qg, 2)} kvar</small></div>
    <div class="kw"><span>Scheinleistung</span><b>${z(m.Sg, 2)} kVA</b><small>N-Leiter ${z(m.iN, 1)} A</small></div>
    <div class="kw ${m.cosg < 0.8 && m.Pg > 0.2 ? 'warn' : ''}"><span>cos φ gesamt</span><b>${z(m.cosg, 2)}</b><small>${m.ind ? 'induktiv' : 'kapazitiv'}</small></div>
    <div class="kw ${m.f < 49.5 || m.f > 50.5 ? 'warn' : ''}"><span>Frequenz</span><b>${z(m.f, 2)} Hz</b><small>Soll 50 Hz</small></div>
    <div class="kw ${df[1]}"><span>Drehfeld</span><b>${df[0]}</b><small>${Number.isFinite(m.unsym) ? 'Unsymmetrie ' + z(m.unsym, 1) + ' %' : '&nbsp;'}</small></div>`;
  $('#quelleStatus').innerHTML = `<span class="pill an">${esc(m.quelle)}</span><span class="pill ${schlecht ? 'rot' : warn ? 'warn' : 'ok'}">${schlecht ? 'Alarm' : warn ? 'Hinweis' : 'Alles in Ordnung'}</span>`;
}
function zelle(wert, n, klasse) { return `<td class="${klasse || ''}">${z(wert, n)}</td>`; }
function zeichneTabelle(m) {
  const ph = [0, 1, 2];
  const uK = k => m.ausfall[k] ? 'schlecht' : (m.u[k] < 207 || m.u[k] > 253) ? 'maessig' : '';
  const iK = k => (Number(cfg.inenn) > 0 && m.i[k] > cfg.inenn) ? 'schlecht' : '';
  $('#messtabelle').innerHTML = `
    <thead><tr><th>Größe</th><th class="ph1">L1</th><th class="ph2">L2</th><th class="ph3">L3</th><th>Gesamt / N</th></tr></thead>
    <tbody>
      <tr><td>Spannung L-N <span class="einheit">V</span></td>${ph.map(k => zelle(m.u[k], 1, uK(k))).join('')}<td></td></tr>
      <tr><td>Spannung L-L <span class="einheit">V</span></td><td>${z(m.ull[0], 1)}<span class="einheit"> L1-L2</span></td><td>${z(m.ull[1], 1)}<span class="einheit"> L2-L3</span></td><td>${z(m.ull[2], 1)}<span class="einheit"> L3-L1</span></td><td></td></tr>
      <tr><td>Strom <span class="einheit">A</span></td>${ph.map(k => zelle(m.i[k], 2, iK(k))).join('')}<td>${z(m.iN, 2)} <span class="einheit">N</span></td></tr>
      <tr><td>Phasenwinkel φ <span class="einheit">°</span></td>${ph.map(k => zelle(m.i[k] > 0.05 ? m.phi[k] : NaN, 1)).join('')}<td></td></tr>
      <tr><td>cos φ</td>${ph.map(k => zelle(m.i[k] > 0.05 ? m.cos[k] : NaN, 2, m.i[k] > 0.05 && m.cos[k] < 0.8 ? 'maessig' : '')).join('')}${zelle(m.cosg, 2)}</tr>
      <tr><td>Wirkleistung P <span class="einheit">kW</span></td>${ph.map(k => zelle(m.P[k], 2)).join('')}${zelle(m.Pg, 2)}</tr>
      <tr><td>Blindleistung Q <span class="einheit">kvar</span></td>${ph.map(k => zelle(m.Q[k], 2)).join('')}${zelle(m.Qg, 2)}</tr>
      <tr><td>Scheinleistung S <span class="einheit">kVA</span></td>${ph.map(k => zelle(m.S[k], 2)).join('')}${zelle(m.Sg, 2)}</tr>
    </tbody>`;
  $('#zeitstempel').textContent = new Date().toLocaleTimeString('de-DE');
}
function pfeil(v, skala, farbe, gestrichelt, text) {
  const x = v.re * skala, y = -v.im * skala, l = Math.hypot(x, y);
  if (l < 2) return '';
  const ux = x / l, uy = y / l, k = 7;
  const sx = x - ux * k, sy = y - uy * k;
  const spitze = `${x},${y} ${sx - uy * 3.5},${sy + ux * 3.5} ${sx + uy * 3.5},${sy - ux * 3.5}`;
  const tx = x + ux * 11, ty = y + uy * 11 + 3;
  return `<line x1="0" y1="0" x2="${sx}" y2="${sy}" stroke="${farbe}" stroke-width="${gestrichelt ? 1.6 : 2.2}" ${gestrichelt ? 'stroke-dasharray="4 3"' : ''}/>
    <polygon points="${spitze}" fill="${farbe}"/><text x="${tx}" y="${ty}" text-anchor="middle" fill="${farbe}">${text}</text>`;
}
function zeichneZeiger(m) {
  const umax = Math.max(...m.u, 1), imax = Math.max(...m.i, m.iN, 0.01);
  const su = 100 / umax, si = 70 / imax;
  let s = '<circle class="kreis" r="100"/><circle class="kreis" r="50"/><line class="achse" x1="-118" y1="0" x2="118" y2="0"/><line class="achse" x1="0" y1="-118" x2="0" y2="118"/>';
  m.U.forEach((v, k) => { s += pfeil(v, su, FARBE[k], false, 'U' + (k + 1)); });
  m.I.forEach((v, k) => { s += pfeil(v, si, FARBE[k], true, 'I' + (k + 1)); });
  if (m.iN > imax * 0.08) s += pfeil(m.I.reduce(plus, C(0, 0)), si, 'var(--n)', true, 'IN');
  $('#zeiger').innerHTML = s;
}
function zeichneBewertung(b) {
  const sym = { ok: '✓', warn: '!', rot: '✗' };
  $('#bewertung').innerHTML = b.sort((x, y) => ({ rot: 0, warn: 1, ok: 2 }[x.stufe] - { rot: 0, warn: 1, ok: 2 }[y.stufe]))
    .map(x => `<li class="${x.stufe}"><span class="sym">${sym[x.stufe]}</span><span><b>${esc(x.titel)}</b>${esc(x.text)}${x.quelle ? `<small>${esc(x.quelle)}</small>` : ''}</span></li>`).join('');
  const n = b.filter(x => x.stufe !== 'ok').length;
  $('#bewertungZahl').textContent = n ? `${n} ${n === 1 ? 'Auffälligkeit' : 'Auffälligkeiten'}` : 'keine Auffälligkeiten';
}
function zeichneVerlauf() {
  const art = document.querySelector('input[name=verlauf]:checked').value;
  const reihen = art === 'p' ? [verlauf.map(v => v.Pg)] : [0, 1, 2].map(k => verlauf.map(v => art === 'u' ? v.u[k] : v.i[k]));
  const farben = art === 'p' ? ['var(--signal)'] : FARBE;
  const alle = reihen.flat().filter(Number.isFinite);
  let lo = Math.min(...alle, art === 'u' ? 200 : 0), hi = Math.max(...alle, art === 'u' ? 250 : 1);
  if (hi - lo < 1) hi = lo + 1;
  const pad = (hi - lo) * 0.1; lo = Math.max(0, lo - pad); hi += pad;
  const X = i => i / (PUFFER - 1) * 600, Y = v => 170 - (v - lo) / (hi - lo) * 160;
  let s = '';
  for (let g = 0; g <= 4; g++) { const y = 10 + g * 40; s += `<line class="gitter" x1="0" y1="${y}" x2="600" y2="${y}"/>`; }
  reihen.forEach((r, k) => {
    const start = PUFFER - r.length;
    s += `<polyline stroke="${farben[k]}" points="${r.map((v, i) => `${X(start + i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
  });
  const einheit = art === 'p' ? 'kW' : art === 'u' ? 'V' : 'A';
  s += `<text x="4" y="20">${z(hi, 1)} ${einheit}</text><text x="4" y="166">${z(lo, 1)} ${einheit}</text>`;
  $('#verlauf').innerHTML = s;
  $('#verlaufInfo').textContent = `Letzte ${Math.round(verlauf.length * TAKT_MS / 1000)} s${art === 'p' ? ', Wirkleistung gesamt' : ', L1 L2 L3'}${aufzeichnung ? ` · Aufzeichnung: ${aufzeichnung.length} Werte` : ''}`;
}

// ---------- Messgerät-Bereich ----------
function zeichneGeraet() {
  const q = cfg.quelle;
  $('#geraetKurz').textContent = { sim: 'Simulation', datei: 'Messdatei', http: 'HTTP/JSON', modbus: 'Modbus TCP' }[q] || q;
  $('#geraetInhalt').innerHTML = `
    <div class="formular">
      <div class="feld"><span class="feld-titel">Datenquelle</span>
        <div class="wahl" id="quelleWahl">
          ${[['sim', 'Simulation'], ['http', 'HTTP/JSON'], ['modbus', 'Modbus TCP']].map(([k, t]) => `<label><input type="radio" name="quelle" value="${k}" ${q === k || (q === 'datei' && k === 'sim') ? 'checked' : ''}>${t}</label>`).join('')}
        </div>
      </div>
      <label>Bemessungsstrom des Verbrauchers in A<input id="inenn" inputmode="decimal" value="${esc(z(Number(cfg.inenn), 1))}"><span class="hilfe">Vom Typschild. Wird für Auslastung und Überlast verwendet.</span></label>
      <div id="quelleDetail"></div>
    </div>`;
  const detail = $('#quelleDetail');
  if (q === 'http') {
    detail.innerHTML = `
      <div class="formular">
        <label>Vorlage<select id="httpVorlage">${Object.entries(HTTP_VORLAGEN).map(([k, v]) => `<option value="${k}" ${cfg.http.vorlage === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
        <label>Adresse<input id="httpUrl" value="${esc(cfg.http.url)}" spellcheck="false"></label>
        <label>Abfrage alle … Sekunden<input id="httpIntervall" type="number" min="1" max="60" value="${Number(cfg.http.intervall)}"></label>
        <p class="untertitel">Zuordnung der Felder in der JSON-Antwort</p>
        <div class="zwei">${HTTP_FELDER.map(([k, t]) => `<label>${t}<input data-map="${k}" value="${esc(cfg.http.map[k] || '')}" spellcheck="false"></label>`).join('')}</div>
        <div class="zeile"><button class="btn btn-primaer klein" type="button" id="httpTest">Verbindung testen</button><span class="meta" id="httpErgebnis"></span></div>
        <div class="hinweis">Der Browser fragt das Gerät direkt ab, die Daten laufen nicht über mechatronik-dev.de. Von einer https-Seite aus geht das nur, wenn das Gerät oder Gateway https und Zugriffe von fremden Seiten (CORS) erlaubt. Feldnamen der Vorlagen nach Herstellerdokumentation prüfen.</div>
        ${http.fehler ? `<div class="hinweis rot">${esc(http.fehler)} Bis dahin laufen die Werte aus der Simulation.</div>` : http.letzte ? '<div class="hinweis ok">Verbunden, Messwerte kommen vom Gerät.</div>' : ''}
      </div>`;
    $('#httpVorlage').onchange = e => { const v = HTTP_VORLAGEN[e.target.value]; cfg.http = { ...cfg.http, vorlage: e.target.value, url: v.url, map: { ...v.map } }; speichern(); zeichneGeraet(); };
    $('#httpUrl').onchange = e => { cfg.http.url = e.target.value.trim(); http = { letzte: null, fehler: '', zeit: 0, laeuft: false }; speichern(); };
    $('#httpIntervall').onchange = e => { cfg.http.intervall = begrenzt(Number(e.target.value) || 2, 1, 60); speichern(); };
    detail.querySelectorAll('[data-map]').forEach(i => i.onchange = () => { cfg.http.map[i.dataset.map] = i.value.trim(); speichern(); });
    $('#httpTest').onclick = async () => { $('#httpErgebnis').textContent = 'Wird geprüft …'; await httpAbfragen(); zeichneGeraet(); };
  } else if (q === 'modbus') {
    const mb = cfg.modbus;
    detail.innerHTML = `
      <div class="formular">
        <div class="kette"><div>Energiezähler<small>Hutschiene, Modbus</small></div><span>Modbus TCP<br>Port ${Number(mb.port)}</span><div>Gateway<small>z. B. Raspberry Pi, Node-RED</small></div><span>https<br>JSON</span><div>Browser<small>dieser Messmonitor</small></div></div>
        <div class="hinweis">Ein Browser kann Modbus nicht direkt sprechen. Ein kleines Gateway im Netz des Betriebs liest die Register zyklisch und stellt sie als JSON bereit. Diese Adresse trägst du dann unter HTTP/JSON ein.</div>
        <div class="drei">
          <label>IP-Adresse Zähler<input id="mbIp" value="${esc(mb.ip)}"></label>
          <label>Port<input id="mbPort" type="number" min="1" max="65535" value="${Number(mb.port)}"></label>
          <label>Geräteadresse (Unit-ID)<input id="mbUnit" type="number" min="0" max="247" value="${Number(mb.unit)}"></label>
        </div>
        <label>Stromwandler-Faktor<input id="mbWandler" inputmode="decimal" value="${esc(z(Number(mb.wandler), 0))}"><span class="hilfe">1 bei Direktmessung, bei Wandler 100/5 A zum Beispiel 20 (falls nicht im Zähler eingestellt).</span></label>
        <p class="untertitel">Register-Vorlage Eastron SDM630 (Input-Register, Funktion 04, Float 32 Bit)</p>
        <div class="tabelle-huelle"><table class="registertabelle"><thead><tr><th>Messgröße</th><th>Register</th><th>Einheit</th></tr></thead><tbody>
          ${SDM630.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>
        <p class="hilfe" style="margin:0">Registeradressen nach Herstellerdokumentation, vor dem Einsatz am Gerät prüfen.</p>
        <div class="zeile"><button class="btn btn-linie klein" type="button" id="mbExport">Gateway-Konfiguration speichern (JSON)</button></div>
      </div>`;
    const setze = (id, k, f) => { $(id).onchange = e => { cfg.modbus[k] = f(e.target.value); speichern(); zeichneGeraet(); }; };
    setze('#mbIp', 'ip', v => v.trim()); setze('#mbPort', 'port', v => begrenzt(Number(v) || 502, 1, 65535));
    setze('#mbUnit', 'unit', v => begrenzt(Number(v) || 1, 0, 247)); setze('#mbWandler', 'wandler', v => lesen(v) > 0 ? lesen(v) : 1);
    $('#mbExport').onclick = () => {
      const k = { geraet: 'Eastron SDM630', verbindung: { protokoll: 'modbus-tcp', ip: mb.ip, port: mb.port, unit_id: mb.unit }, funktion: 4, datentyp: 'float32', wortfolge: 'big-endian',
        intervall_s: 1, stromwandler_faktor: mb.wandler, register: Object.fromEntries(SDM630.map(r => [r[0], { register: Number(r[1]), adresse: Number(r[1]) - 30001, einheit: r[2] }])),
        ausgabe: { format: 'json', felder: { u: { l1: 'U L1-N', l2: 'U L2-N', l3: 'U L3-N' }, i: { l1: 'I L1', l2: 'I L2', l3: 'I L3' }, cos: { l1: 'cos φ L1', l2: 'cos φ L2', l3: 'cos φ L3' }, f: 'Frequenz' } } };
      herunterladen('gateway-sdm630.json', JSON.stringify(k, null, 2), 'application/json');
    };
  } else {
    detail.innerHTML = '<div class="hinweis ok">Die Messwerte kommen aus dem Simulator rechts. Dort lassen sich Szenarien wählen, Werte je Phase einstellen oder Messdateien abspielen.</div>';
  }
  document.querySelectorAll('input[name=quelle]').forEach(r => r.onchange = () => { cfg.quelle = r.value; if (r.value === 'sim') datei = null; http = { letzte: null, fehler: '', zeit: 0, laeuft: false }; speichern(); zeichneGeraet(); zeichneSim(); });
  $('#inenn').onchange = e => { const v = lesen(e.target.value); cfg.inenn = Number.isFinite(v) && v >= 0 ? v : cfg.inenn; speichern(); };
}

// ---------- Simulator ----------
function zeichneSim() {
  const aktivDatei = !!datei;
  $('#simStatus').textContent = cfg.quelle === 'sim' ? (aktivDatei ? 'Messdatei läuft' : 'aktiv') : cfg.quelle === 'http' && http.letzte ? 'pausiert, Gerät verbunden' : 'aktiv als Ersatz';
  const sz = SZENARIEN[sim.szenario];
  $('#simInhalt').innerHTML = `
    <div class="formular">
      <p class="untertitel">Szenario</p>
      <div class="szenarien">${Object.entries(SZENARIEN).map(([k, s]) => `<button type="button" class="szenario ${sim.szenario === k && !aktivDatei ? 'aktiv' : ''}" data-sz="${k}">${esc(s.titel)}</button>`).join('')}</div>
      ${sz && !aktivDatei ? `<div class="hinweis ok"><b>${esc(sz.titel)}:</b> ${esc(sz.text)}</div>` : ''}
      <hr class="trenner">
      <p class="untertitel">Werte je Phase</p>
      <table class="phasen-tabelle"><thead><tr><th></th><th>U in V</th><th>I in A</th><th>cos φ</th></tr></thead><tbody>
        ${[0, 1, 2].map(k => `<tr><td class="ph${k + 1}">L${k + 1}</td>
          <td><input data-w="u" data-k="${k}" inputmode="decimal" value="${esc(z(Number(sim.u[k]), 1))}" aria-label="Spannung L${k + 1}"></td>
          <td><input data-w="i" data-k="${k}" inputmode="decimal" value="${esc(z(Number(sim.i[k]), 1))}" aria-label="Strom L${k + 1}"></td>
          <td><input data-w="cos" data-k="${k}" inputmode="decimal" value="${esc(z(Number(sim.cos[k]), 2))}" aria-label="cos phi L${k + 1}"></td></tr>`).join('')}
      </tbody></table>
      <div class="zwei">
        <label>Frequenz in Hz<input id="simF" inputmode="decimal" value="${esc(z(Number(sim.f), 2))}"></label>
        <label>Schwankung in %<input id="simR" type="range" min="0" max="5" step="0.5" value="${Number(sim.rauschen)}"><span class="hilfe" id="simRWert">${z(Number(sim.rauschen), 1)} %</span></label>
      </div>
      <div class="feld"><span class="feld-titel">Drehfeld</span><div class="wahl klein">
        <label><input type="radio" name="simDf" value="rechts" ${sim.drehfeld !== 'links' ? 'checked' : ''}>Rechts</label><label><input type="radio" name="simDf" value="links" ${sim.drehfeld === 'links' ? 'checked' : ''}>Links</label></div></div>
      <div class="feld"><span class="feld-titel">Last</span><div class="wahl klein">
        <label><input type="radio" name="simLast" value="ind" ${sim.last !== 'kap' ? 'checked' : ''}>Induktiv (Motor)</label><label><input type="radio" name="simLast" value="kap" ${sim.last === 'kap' ? 'checked' : ''}>Kapazitiv</label></div></div>
      <hr class="trenner">
      <p class="untertitel">Messdatei abspielen</p>
      <div class="datei-box">
        <input type="file" id="simDatei" accept=".csv,text/csv" aria-label="CSV-Messdatei wählen">
        <span class="hilfe">CSV mit Spalten zeit; U1; U2; U3; I1; I2; I3; cos1; cos2; cos3; f. Trennzeichen Semikolon oder Komma, Dezimalkomma oder Punkt.</span>
        <div class="zeile">
          <button class="btn btn-linie klein" type="button" id="simBeispiel">Beispiel abspielen</button>
          <button class="btn btn-linie klein" type="button" id="simBeispielLaden">Beispieldatei speichern</button>
          ${aktivDatei ? '<button class="btn btn-primaer klein" type="button" id="simDateiStop">Datei stoppen</button>' : ''}
        </div>
        ${aktivDatei ? `<span class="meta">${esc(datei.name)}: ${datei.zeilen.length} Messwerte, läuft in Schleife</span>` : ''}
      </div>
    </div>`;
  const s = $('#simInhalt');
  s.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => {
    const v = SZENARIEN[b.dataset.sz];
    sim = { ...sim, szenario: b.dataset.sz, u: [...v.u], i: [...v.i], cos: [...v.cos], f: v.f, drehfeld: v.drehfeld };
    datei = null; if (cfg.quelle !== 'http') cfg.quelle = 'sim'; speichern(); zeichneSim(); zeichneGeraet();
  });
  s.querySelectorAll('[data-w]').forEach(inp => inp.onchange = () => {
    const v = lesen(inp.value), k = Number(inp.dataset.k), w = inp.dataset.w;
    if (!Number.isFinite(v) || v < 0 || (w === 'cos' && v > 1) || (w === 'u' && v > 500) || (w === 'i' && v > 5000)) { toast('Ungültiger Wert'); inp.value = z(Number(sim[w][k]), w === 'cos' ? 2 : 1); return; }
    sim[w][k] = v; sim.szenario = ''; speichern(); zeichneSim();
  });
  $('#simF').onchange = e => { const v = lesen(e.target.value); if (v >= 40 && v <= 70) { sim.f = v; sim.szenario = ''; speichern(); } else toast('Frequenz zwischen 40 und 70 Hz'); zeichneSim(); };
  $('#simR').oninput = e => { sim.rauschen = Number(e.target.value); $('#simRWert').textContent = z(sim.rauschen, 1) + ' %'; speichern(); };
  s.querySelectorAll('input[name=simDf]').forEach(r => r.onchange = () => { sim.drehfeld = r.value; sim.szenario = ''; speichern(); zeichneSim(); });
  s.querySelectorAll('input[name=simLast]').forEach(r => r.onchange = () => { sim.last = r.value; speichern(); });
  $('#simDatei').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 2e6) { toast('Datei zu groß (höchstens 2 MB)'); return; }
    dateiStarten(f.name, await f.text());
  };
  $('#simBeispiel').onclick = () => dateiStarten('beispiel-motoranlauf.csv', beispielCsv());
  $('#simBeispielLaden').onclick = () => herunterladen('beispiel-motoranlauf.csv', beispielCsv(), 'text/csv');
  if ($('#simDateiStop')) $('#simDateiStop').onclick = () => { datei = null; zeichneSim(); };
}

function csvLesen(text) {
  const zeilen = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!zeilen.length) throw new Error('Datei ist leer');
  const trenner = (zeilen[0].match(/;/g) || []).length >= 3 ? ';' : (zeilen[0].match(/\t/g) || []).length >= 3 ? '\t' : ',';
  const kopf = zeilen[0].split(trenner).map(x => x.trim().toLowerCase().replace(/\s+/g, ''));
  const hatKopf = kopf.some(k => /^[a-z]/.test(k));
  const namen = ['u1', 'u2', 'u3', 'i1', 'i2', 'i3', 'cos1', 'cos2', 'cos3', 'f'];
  const index = hatKopf ? Object.fromEntries(namen.map(n => [n, kopf.indexOf(n)])) : Object.fromEntries(namen.map((n, i) => [n, i + 1]));
  if (['u1', 'u2', 'u3', 'i1', 'i2', 'i3'].some(n => index[n] < 0)) throw new Error('Spalten U1 bis U3 und I1 bis I3 werden benötigt');
  const df = hatKopf ? kopf.indexOf('drehfeld') : -1;
  const daten = zeilen.slice(hatKopf ? 1 : 0).slice(0, 20000).map(l => {
    const t = l.split(trenner), w = n => index[n] >= 0 ? lesen(t[index[n]]) : NaN;
    const cos = [w('cos1'), w('cos2'), w('cos3')].map(c => Number.isFinite(c) ? begrenzt(Math.abs(c), 0, 1) : 1);
    return { u: [w('u1'), w('u2'), w('u3')], i: [w('i1'), w('i2'), w('i3')].map(Math.abs), cos, f: Number.isFinite(w('f')) ? w('f') : 50,
      drehfeld: df >= 0 && /links|l/i.test(t[df] || '') ? 'links' : 'rechts' };
  }).filter(r => r.u.every(Number.isFinite) && r.i.every(Number.isFinite));
  if (!daten.length) throw new Error('Keine gültigen Messwerte gefunden');
  return daten;
}
function dateiStarten(name, text) {
  try { datei = { name, zeilen: csvLesen(text), pos: 0 }; cfg.quelle = 'sim'; toast(`${datei.zeilen.length} Messwerte geladen`); zeichneSim(); zeichneGeraet(); }
  catch (e) { toast(e.message); }
}
function beispielCsv() {
  // Motoranlauf 7,5 kW: Anlaufstrom, Nennbetrieb, dann fällt L3 aus
  const z2 = x => x.toFixed(2).replace('.', ',');
  const r = ['zeit;U1;U2;U3;I1;I2;I3;cos1;cos2;cos3;f'];
  for (let n = 0; n < 80; n++) {
    const t = n * 0.5;
    let i = 14.3, cos = 0.86, u = [230.5, 231.2, 229.8], ausfall = false;
    if (t < 1) { i = 0; cos = 1; }
    else if (t < 4) { const a = (t - 1) / 3; i = 14.3 + (86 - 14.3) * Math.pow(1 - a, 2); cos = 0.35 + 0.51 * a; u = u.map(x => x - 9 * (1 - a)); }
    if (t >= 28) { ausfall = true; i = 24.7; cos = 0.72; }
    const w = (x, s) => x * (1 + (Math.sin(n * 1.7 + s) * 0.004));
    const iz = [w(i, 1), w(i, 2), ausfall ? 0 : w(i, 3)];
    const uz = [w(u[0], 4), w(u[1], 5), ausfall ? 0 : w(u[2], 6)];
    r.push([t.toFixed(1).replace('.', ','), ...uz.map(z2), ...iz.map(z2), z2(cos), z2(cos), z2(ausfall ? 0 : cos), z2(50 + Math.sin(n / 9) * 0.02)].join(';'));
  }
  return r.join('\n');
}
function herunterladen(name, inhalt, typ) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([inhalt], { type: typ + ';charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- Takt ----------
function takt() {
  let probe;
  if (cfg.quelle === 'http') {
    if (Date.now() - http.zeit > cfg.http.intervall * 1000 && !http.laeuft) httpAbfragen().then(() => { if (geraetOffen) zeichneGeraet(); zeichneSim(); });
    probe = http.letzte && Date.now() - http.zeit < 15000 ? http.letzte : probeSimulation();
  } else probe = datei ? probeDatei() : probeSimulation();
  const m = rechnen(probe), b = bewerten(m);
  verlauf.push(m); if (verlauf.length > PUFFER) verlauf.shift();
  if (aufzeichnung && aufzeichnung.length < 20000) aufzeichnung.push({ zeit: new Date(), m });
  zeichneKopf(m, b); zeichneTabelle(m); zeichneZeiger(m); zeichneVerlauf();
  zeichneBewertung(b);
}

$('#geraetKopf').onclick = () => {
  geraetOffen = !geraetOffen;
  $('#geraetInhalt').hidden = !geraetOffen; $('#geraetKopf').setAttribute('aria-expanded', String(geraetOffen));
  if (geraetOffen) zeichneGeraet();
};
document.querySelectorAll('input[name=verlauf]').forEach(r => r.onchange = zeichneVerlauf);
$('#aufzeichnen').onclick = () => {
  if (aufzeichnung) { $('#aufzeichnen').textContent = 'Aufzeichnung starten'; $('#exportieren').disabled = !aufzeichnung.length; aufzeichnungFertig = aufzeichnung; aufzeichnung = null; toast('Aufzeichnung beendet'); }
  else { aufzeichnung = []; aufzeichnungFertig = null; $('#aufzeichnen').textContent = 'Aufzeichnung beenden'; $('#exportieren').disabled = true; toast('Aufzeichnung läuft'); }
};
let aufzeichnungFertig = null;
$('#exportieren').onclick = () => {
  const liste = aufzeichnungFertig || []; if (!liste.length) return;
  const k = x => Number.isFinite(x) ? x.toFixed(3).replace('.', ',') : '';
  const zeilen = ['zeit;U1;U2;U3;I1;I2;I3;cos1;cos2;cos3;f;P_kW;Q_kvar;S_kVA;IN;drehfeld'];
  liste.forEach(({ zeit, m }) => zeilen.push([zeit.toISOString(), ...m.u.map(k), ...m.i.map(k), ...m.cos.map(k), k(m.f), k(m.Pg), k(m.Qg), k(m.Sg), k(m.iN), m.drehfeld].join(';')));
  herunterladen('messung-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv', zeilen.join('\n'), 'text/csv');
};

const startSz = new URLSearchParams(location.search).get('szenario');
if (startSz && SZENARIEN[startSz]) { const v = SZENARIEN[startSz]; sim = { ...sim, szenario: startSz, u: [...v.u], i: [...v.i], cos: [...v.cos], f: v.f, drehfeld: v.drehfeld }; cfg.quelle = 'sim'; }
zeichneSim();
zeichneGeraet();
$('#geraetKurz').textContent = { sim: 'Simulation', datei: 'Messdatei', http: 'HTTP/JSON', modbus: 'Modbus TCP' }[cfg.quelle] || 'Simulation';
for (let n = 0; n < 6; n++) { const m = rechnen(probeSimulation()); verlauf.push(m); }
takt();
setInterval(() => { if (!document.hidden) takt(); }, TAKT_MS);
