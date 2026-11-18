# Testdateien

`hochkant-p3.heic` ist ein selbst erzeugtes Testbild ohne fremde Inhalte. Es hat 96 × 64 Pixel, links rot und rechts blau, ist um 90 Grad gedreht gespeichert und trägt ein Farbprofil mit den Primärfarben von Display P3 sowie EXIF-Daten einer erfundenen Kamera. Die Tests prüfen damit, ob MoeCloud HEIC dekodiert, richtig dreht, die Farben umrechnet und die Bildinfos liest.

Erzeugt wurde es mit Pillow und pillow-heif, Qualität 92 und Farbabtastung 4:4:4.

Im Ordner `host/` liegen Attrappen für `docker`, `curl` und ein paar Befehle des Systems. `test/host.ts` stellt sie vor den Suchpfad und lässt damit `install.sh` und den Befehl `moecloud` in einem leeren Ordner laufen, ohne Docker, ohne Netz und ohne Rechte als root. Die Attrappe für `docker` löst das Tag des Images aus `docker-compose.yml` und `.env` auf und kennt eine Registry, in der nur liegt, was der Test dort ablegt. So zeigt sich, welches Image ein Skript wirklich laden würde.
