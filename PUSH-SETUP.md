# AllesImBlick – Push-Erinnerungen (Entwicklungszweig)

Dieser Zweig ist ein isolierter Technik-Prototyp. Die produktive `main`-Version bleibt unverändert.

## Stand
- `push-test.html` prüft die Web-Notification-/Service-Worker-Unterstützung und die Berechtigung auf dem Gerät.
- Der lokale Test zeigt eine Benachrichtigung über den Service Worker.
- `sw.js` enthält bereits den Empfänger für echte Push-Events (`push`) und das Öffnen beim Antippen.
- **Noch nicht aktiv:** zeitgesteuerte Erinnerungen bei geschlossener App. Dafür ist ein Push-Backend erforderlich.

## Warum ein Backend nötig ist
Die App speichert Einträge aktuell nur in `localStorage` auf dem jeweiligen Gerät. Ein statischer GitHub-Pages-Auftritt kann keine Benachrichtigungen zu einem späteren Zeitpunkt an ein geschlossenes Gerät senden. Dafür müssen Geräte-Push-Abonnements sicher registriert und Erinnerungen serverseitig geplant und versendet werden.

## Geplante Architektur
1. Push-Anbieter mit Web Push/VAPID einrichten.
2. Kleines Backend mit sicherem Speicher für Push-Abonnements und Erinnerungszeitpunkte bereitstellen.
3. Beim Speichern/Ändern/Löschen eines Eintrags die geplanten Erinnerungen serverseitig aktualisieren.
4. Push-Events über den Service Worker anzeigen.
5. Auf Android/Chrome sowie iPhone/iPad testen. Auf iOS muss die Web-App zum Home-Bildschirm hinzugefügt und Benachrichtigungen müssen ausdrücklich erlaubt werden.

## Sicherheitsregeln
- Private VAPID-Schlüssel und Backend-Secrets niemals in HTML, JavaScript oder GitHub Pages ablegen.
- Vor dem produktiven Einsatz braucht es Datenschutzinformationen, Lösch-/Abmeldefunktion und einen Test für mehrere Geräte.
- Keine Änderung an `index.html` oder der produktiven `main`-Version, bis Ende-zu-Ende-Push funktioniert.
