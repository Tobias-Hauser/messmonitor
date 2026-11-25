# Messmonitor Drehstrom

Drehstrom live auswerten wie mit einem Netzanalysator: Spannung, Strom, Leistung, cos φ, Frequenz und Drehfeld je Phase, mit Zeigerdiagramm und Bewertung.

**Live:** https://mechatronik-dev.de/messmonitor/ (Teil von [MechatronikerDev](https://mechatronik-dev.de))

## Was es kann

- **Messwerte je Phase:** U, I, P, Q, S, cos φ, Frequenz
- **Zeigerdiagramm** für Spannungen und Ströme
- **Drehfeld** erkennen (rechts oder links)
- **Neutralleiterstrom** und **Unsymmetrie** über Mit- und Gegensystem
- **Bewertung** der Spannungsqualität nach EN 50160
- Klare Meldungen, was ein Messbild in der Praxis bedeutet

## Messquellen

| Quelle | Beschreibung |
|---|---|
| Simulation | Simulator mit Werten je Phase, Lastart und Rauschen |
| Messdatei | CSV-Datei abspielen |
| HTTP / JSON | Messwerte von einem Gerät im Netzwerk abfragen |
| Modbus-TCP | Vorlage für Energiezähler wie den SDM630, über ein Modbus-Gateway |

## Szenarien aus der Praxis

Normalbetrieb, Phasenausfall, Linksdrehfeld, Schieflast, Überlast und weitere. Jedes Szenario erklärt, woran man den Fehler im Messbild erkennt.

## Aufbau

Läuft komplett im Browser, ohne Server und ohne Konto. Reines HTML, CSS und JavaScript.

```
index.html   Seite
app.js       Simulator, Zeigerrechnung, Auswertung
style.css    Design
```

---

Entwickelt von **Tobias Hauser**, Mechatroniker (IHK) und Elektrofachkraft aus Freiburg, mit KI-Unterstützung.
