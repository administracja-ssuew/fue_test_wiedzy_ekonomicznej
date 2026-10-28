// Kanał sygnałów sesji `quiz-<id>` (broadcast `quiz_event`) współdzielony w obrębie jednego klienta.
//
// Powód (finał 27.10.2026, 94× client_error): realtime-js zwraca ISTNIEJĄCY kanał o tej samej
// nazwie. Poczekalnia, hook gry, Live View i panel admina zakładały każdy `quiz-<id>`, więc:
//  - dopisanie postgres_changes do kanału już subskrybowanego rzucało wyjątek (ekran błędu
//    na telefonach przy starcie sesji),
//  - removeChannel w jednym miejscu zamykał kanał wszystkim pozostałym (np. poczekalnia
//    znikająca przy starcie zabierała hookowi gry subskrypcję).
// Tu: jeden kanał na sesję z licznikiem użytkowników; zamyka go dopiero ostatni.
// postgres_changes każdy odbiorca zakłada na WŁASNYM kanale (uniqueTopic) — filtr działa
// niezależnie od nazwy kanału, więc nic nie tracimy.

const EVENT = "quiz_event";
const entries = new WeakMap(); // client → Map(topic → { channel, listeners:Set, holders })

function entryFor(client, sessionId) {
  let byTopic = entries.get(client);
  if (!byTopic) { byTopic = new Map(); entries.set(client, byTopic); }
  const topic = `quiz-${sessionId}`;
  let e = byTopic.get(topic);
  if (!e) {
    const listeners = new Set();
    const channel = client.channel(topic)
      .on("broadcast", { event: EVENT }, (msg) => { for (const fn of [...listeners]) { try { fn(msg); } catch (_) { /* słuchacz nie może wywrócić innych */ } } })
      .subscribe();
    e = { topic, channel, listeners, holders: 0 };
    byTopic.set(topic, e);
  }
  return { e, byTopic };
}

function releaseOnce(client, sessionId, e, byTopic) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    e.holders -= 1;
    if (e.holders <= 0 && byTopic.get(e.topic) === e) {
      byTopic.delete(e.topic);
      try { client.removeChannel(e.channel); } catch (_) { /* nieistotne */ }
    }
  };
}

// Słuchaj sygnału `quiz_event` sesji. Zwraca funkcję odpięcia (bezpieczna przy wielokrotnym wywołaniu).
export function listenSessionSignal(client, sessionId, onSignal) {
  const { e, byTopic } = entryFor(client, sessionId);
  e.listeners.add(onSignal);
  e.holders += 1;
  const release = releaseOnce(client, sessionId, e, byTopic);
  return () => { e.listeners.delete(onSignal); release(); };
}

// Kanał sesji do WYSYŁANIA sygnałów (panel admina). Trzyma kanał otwarty do release().
export function sessionSignalChannel(client, sessionId) {
  const { e, byTopic } = entryFor(client, sessionId);
  e.holders += 1;
  return { channel: e.channel, release: releaseOnce(client, sessionId, e, byTopic) };
}

// Unikalna nazwa kanału dla postgres_changes (nigdy nie współdzielona z innym odbiorcą).
let seq = 0;
export function uniqueTopic(base) {
  seq += 1;
  return `${base}-${Date.now().toString(36)}${seq}${Math.random().toString(36).slice(2, 6)}`;
}
