import { useEffect, useRef, useState } from 'react';
import { View, Platform, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { theme } from './src/ui/theme';
import { LoadoutScreen } from './src/ui/LoadoutScreen';
import { ArenaScreen } from './src/ui/ArenaScreen';
import type { LoadoutChoice } from './src/game/loadout';
import { ProductEventRecorder } from './src/telemetry/product-event-recorder';
import { appendProductEventLines } from './src/telemetry/product-event-sink';
import appConfig from './app.json';

// The screens know nothing about telemetry: they report what happened through callbacks and this
// component, which is the only place that knows how the app is navigated, turns that into events.
export default function App() {
  const [choice, setChoice] = useState<LoadoutChoice | null>(null);
  const recorderRef = useRef<ProductEventRecorder | null>(null);
  if (recorderRef.current === null) {
    recorderRef.current = new ProductEventRecorder(appendProductEventLines, appConfig.expo.version, Platform.OS);
  }
  const recorder = recorderRef.current;

  // Declared before the loadout effect so the stream opens with sessionStarted.
  useEffect(() => {
    void recorder.sessionStarted();
  }, [recorder]);

  useEffect(() => {
    if (choice === null) {
      void recorder.loadoutOpened();
    }
  }, [choice, recorder]);

  // There is no reliable "the app was closed" signal, so the first move to the background stands in
  // for the end of the session; later returns and departures are not recorded as new sessions.
  useEffect(() => {
    let ended = false;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !ended) {
        ended = true;
        void recorder.sessionEnded('background');
      }
    });
    return () => subscription.remove();
  }, [recorder]);

  const startMatch = (started: LoadoutChoice) => {
    const first = started.loadout.classes[0];
    void recorder.matchStarted({
      className: first.characterClass.name,
      classLevel: first.level,
      partySize: started.partySize,
      enemyCount: started.enemyCount,
    });
    setChoice(started);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Platform.OS === 'android' ? 28 : 0 }}>
      <StatusBar style="light" />
      {choice === null ? (
        <LoadoutScreen onStart={startMatch} />
      ) : (
        <ArenaScreen
          choice={choice}
          onRestart={() => setChoice(null)}
          onMatchEnded={(result, rounds) => void recorder.matchEnded(result, rounds)}
          onMatchAbandoned={(rounds) => void recorder.matchAbandoned(rounds)}
        />
      )}
    </View>
  );
}
