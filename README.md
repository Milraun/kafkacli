# Software Dokumentation
<strong>kafkacli</strong><br/>

*Inhaltsverzeichnis*

- [Software Dokumentation](#software-dokumentation)
  - [Einführung](#einf%c3%bchrung)
  - [Software Lifecycle Management](#software-lifecycle-management)
  - [Anforderungen](#anforderungen)
    - [funktionale Anforderungen](#funktionale-anforderungen)
    - [nicht funktionale Anforderungen](#nicht-funktionale-anforderungen)
  - [Konzepte](#konzepte)
  - [Implementierung](#implementierung)
  - [API](#api)
  - [Daten](#daten)
  - [Interaktion mit anderen Systemen](#interaktion-mit-anderen-systemen)
  - [Testen](#testen)
  - [Betrieb](#betrieb)
    - [Deployment](#deployment)
    - [Konfiguration](#konfiguration)
    - [Start/Stop](#startstop)
    - [Monitoring](#monitoring)

## Einführung

kafkacli ist ein kleines Werkzeug, um viele Aufgabe bei der Administration Kafka-Clustern zu vereinfachen.

Verschiedene Anstöße waren die Motivation für die Erstellung des Tools:

* Ich wollte etwas mit nodejs and typescript herumspielen, um auch einmal über den Tellerand unserer java-zentrierten Welt zu schauen.
* Die Skripte, die mit der Kafka-Installation geliefert werden sind m.E. sehr langsam und etwas hakelig zu bedienen. Ich wollte ein Tool für wiederkehrende Aufgaben, das schneller und leichtgewichtiger ist.

## Software Lifecycle Management

<table>
  <tr>
    <td width="25%"><b>SourceCode Repository</b></td>
    <td><a href="#">[GitLab](https://gitlab.heuboe.hbintern/jaybees-test/kafkacli)</a></td>
  </tr>
	<tr>
		<td width="25%"><b>Maven-Artefakt</b></td>
		<td><a href="#">---</a></td>
	</tr>
	<tr>
		<td><b>Issue Management</b></td>
		<td><a href="#">---</a></td>
	</tr>
  <tr>
		<td><b>Produkt-DB</b></td>
		<td><a href="#">---</a></td>
	</tr>
	<tr>
		<td><b>Quality Management</b></td>
		<td><a href="#">---</a></td>
	</tr>
	<tr>
		<td><b>Continuous Integration</b></td>
		<td><a href="#">--</a></td>
	</tr>
</table>

## Anforderungen

### funktionale Anforderungen

* so wenig Parameter wie möglich. 
  * Connection Parameter etc. in Dateiein
  * Defaults
* Unterstützt Protobuf ala vmis2
* Gleichzeitige Anwendung auf viele Topics durch Regular Expressions
* Definition von Topic-Konfigurationen über Dateien, die im Git verwaltet werden können.

### nicht funktionale Anforderungen

* Klein
* Schnell

## Konzepte

Beim vmis2-situation-tool, das ähnliche Aufgaben erfüllt waren mit die Start- und Ausführzeiten deutlich zu lange. Deshalb hier der Ansatz über nodejs als Kommandozeilenapplikation.

Zusätzlich gibt es für nodejs das Tool **nexe** mit dem relative einfach ein ausführbare Datei erzeugt werden kann, die keine Installation benötigt.

## Implementierung

Das ganze Projekt ist ein privates "Spielprojekt". Deshalb genügt die Software aktuell nicht den gängigen Kodierungsrichtlinien bei HB

Für die Entwicklung muss ein aktuelle NodeJs und npm installiert sein. Nach dem klonen kann man mit **npm install** all lokal genutzte Packages herunterladen.

**nexe** habe ich global installiert: npm install -g nexe.

Entwickelt wurde mit VSCode. Dafür gilt auch die launch.json zum Starten in der Entwicklungsumgebung und zum Debuggen.

Übersetzt wird das ganze mit:

    npm run build

Eine Binärdatei erzeugen mit: 

    nexe lib/index.js (unter Windows)

Unter CentOs kann man eine neue Version auf dem ersten Kubernetes-Master des VMIS-Testsystem (172.31.246.1) im Verzeichnis:

    /root/kafkacli 
mit dem Befehl

    nexe lib/index.js --verbose -t static -b
übersetzten. Die Schwierigkeit war, das NodeJs erst für CentOs übersetzt und dann statisch gelinkt werden musste. Deshalb geht das aktuell nur dort.

## API

## Daten

Das Tool liest diverse Dateien. Der Aufbau sollte den Beispielen entnommen werden.

## Interaktion mit anderen Systemen

Kommuniziert mit einem Kafka-Cluster

## Testen

Bisher keine ausser händisches ausprobieren.

## Betrieb
Ich habe einen Ordner zusammengepackt der unter:

    \\\\JUERGENB-WX\public\kafkacli\0.0.1\

zu finden ist. Er enthält Binaries und Beispiele für
  * Eine Konfigurationsdatei (config.json)
  * Eine Datei zu Dekodierung der Protos (vmis2proto.json). Diese wird automatsich aus den Protos generiert. Im Projekt gibt es eine compileProtos.cmd, die aktuell das vmis2-kernsystem-schema benutzt, um alle Protos herunter zu laden und diese zu kompilieren.
  * Eine Datei mit den Einstellungen für die Vmis2-Topics nach neuer Struktur (vmis2-topcis.yaml). Diese Datei sollte schussendlich nicht hier liegen sondern bei der Konfiguration des jeweiligen Systems. **Sie kann für die Befehle createTopics und alterTopics benutzt werden. Bei createTopics werden existierende Topics ignoriert.Bei alterTopics werden nicht existierende Topics ignoriert.** 
### Deployment
Aktuell gibt es zwei ausführbare Binaries
* kafkacli.exe für Windows
* kafkacli für CentOs
### Konfiguration
siehe config.json
### Start/Stop
* kafkacli -h gibt alle möglichen Befehle aus. 
* kafkacli BEFEHL -h gibt nähere Infos zu einem Befehl
* config.json und vmis2proto.json werden im aktuellen Verzeichnis gesucht oder müssen mit -c und/oder -p angegeben werden.
* Bei der Nutzung in der GitBash ist zu beachten, dass diese keine tty-Device zur Verfügung stellt (was immer das heißt). Bei Befehlen, die interaktive Eingaben vom Benutzer verlangen funktioniert das nicht. In diesem Fall muss man ein **winpty** voranstellen.
  
    winpty ./kafkacli.exe deleteTopics 'Müll.*'
    
* Aktuell wird nur bei **deleteTopics** nachgefragt.
### Monitoring
