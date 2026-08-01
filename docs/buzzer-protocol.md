# Buzzer hardware protocol

The server accepts buzz events from physical buzzers through two transports.
Both feed the same authoritative arbiter, and **ordering is decided by server
receive time** — device timestamps are recorded for diagnostics only, never
for ordering. That means: optimize your firmware for *send latency*, not
clock accuracy. Send the instant the button closes; don't batch, don't wait
for the ack before being ready to send the next press.

Each physical button has a **buzzer ID** — any short string (`B1`, `red`,
`podium-3`, a MAC suffix...). The showrunner maps buzzer IDs to teams in the
session setup screen: press the button and it appears there ("press to
capture"), then tap the team to bind it. Unmapped presses are rejected but
surfaced to the showrunner, so capture works before mapping exists.

Recommended local debounce: ignore re-presses within ~200 ms on the device.
The server also rejects duplicate buzzes from the same team within one race,
so double-sends are harmless.

## Transport 1: HTTP POST (simplest — ESP8266/ESP32/Arduino + Ethernet)

```
POST http://<server>:3001/api/sessions/<CODE>/buzz
Content-Type: application/json

{"buzzerId": "B3", "ts": 123456789}
```

Responses (check the body's `accepted`/`reason`; the status code varies):

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{"accepted": true, "order": 1}` | Buzz accepted; `order` is its place in the race |
| 200 | `{"accepted": false, "reason": "not-open" \| "locked-out" \| "duplicate" \| "unmapped"}` | Arbitration rejected the buzz |
| 400 | `{"accepted": false, "reason": "invalid"}` | Missing/empty `buzzerId` in the payload |
| 404 | `{"accepted": false, "reason": "no-session"}` | Unknown session code in the URL |

Firmware can fire-and-forget (ignore responses entirely); the `reason` field
is mainly useful while setting up. The WebSocket transport acks the same
`{accepted, order?, reason?}` shape for every case.

`<CODE>` is the 4-character session code shown in the showrunner console.
`ts` is optional (device millis; diagnostics only).

### Arduino/ESP32 sketch fragment

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* SERVER = "http://192.168.1.50:3001";
const char* CODE   = "KJ4T";
const char* BUZZER_ID = "B1";
const int   PIN = 14;

unsigned long lastPress = 0;

void loop() {
  if (digitalRead(PIN) == LOW && millis() - lastPress > 200) {
    lastPress = millis();
    HTTPClient http;
    http.begin(String(SERVER) + "/api/sessions/" + CODE + "/buzz");
    http.addHeader("Content-Type", "application/json");
    // Fire and forget — don't block the next press on the response.
    http.POST("{\"buzzerId\":\"" + String(BUZZER_ID) + "\"}");
    http.end();
  }
}
```

Tip: keep the TCP connection warm if your HTTP library supports it —
connection setup is most of the latency on small microcontrollers.

## Transport 2: Socket.IO `/buzzers` namespace (lower latency — Pi bridge)

Best when a Raspberry Pi (or laptop) reads the buttons over GPIO/serial and
relays them. One persistent connection, no per-press handshake.

Connect to namespace `/buzzers` with `auth: { code: "<CODE>" }`, then emit:

```js
socket.emit('buzz', { buzzerId: 'B3' }, (res) => {
  // res: {accepted, order?, reason?} — same shape as HTTP
});
```

### Node serial-bridge example (~15 lines)

```js
// npm i socket.io-client serialport
import { io } from 'socket.io-client';
import { ReadlineParser, SerialPort } from 'serialport';

const socket = io('http://192.168.1.50:3001/buzzers', { auth: { code: 'KJ4T' } });
const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 115200 });
const lines = port.pipe(new ReadlineParser());

// Firmware prints one line per press, e.g. "B3"
lines.on('data', (line) => {
  const buzzerId = line.trim();
  if (buzzerId) socket.emit('buzz', { buzzerId });
});
```

## Testing without hardware

- **Browser simulator:** open `/dev/buzzers`, enter the session code and
  buzzer IDs. Buttons + keyboard keys 1–8 (for racing two buzzes from one
  keyboard). This is also the live fallback if hardware dies mid-event.
- **Scripted:** `node scripts/fake-buzzer.mjs <code> <buzzerId> [delayMs]`
  fires timed buzzes over both transports with jitter — it exercises the
  exact protocol above.

## Security model (trusted event LAN)

Buzz ingest is authenticated by the session code alone — no per-buzzer
secret — and competitor tablets authenticate with the code plus their team
ID. This is a deliberate decision for a no-accounts app running on a network
you control (the event venue's LAN or a dedicated AP): microcontrollers stay
trivially simple, and a lost tablet can be re-opened with a URL. Do not
expose the server to the open internet; if you must, put it behind a reverse
proxy with its own authentication. Showrunner and host roles are always
protected by per-session secret keys.

## Semantics worth knowing

- Buzzes are only accepted while a race is open (`buzzing-open` phase). The
  first accepted buzz wins and moves the game to judging; later buzzes are
  still recorded so the host sees full buzz order.
- After a wrong answer the race **reopens fresh** for the remaining teams —
  the previous queue is discarded (position 2 buzzed before hearing the wrong
  answer, so a fresh race is fairer).
- A team that answered wrong is locked out for the rest of that clue.
