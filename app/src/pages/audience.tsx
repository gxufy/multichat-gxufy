/* /audience — neutral third-party embed for the production viewer counter.
 *
 * Pogly and similar widget hosts use this path instead of /counter so content
 * blockers do not have to allow generic counter/viewer URL names. Rendering,
 * polling cadence, Kick handling, Google Fonts, and MultiChat background-control
 * behavior all stay in the shared CounterRuntime.
 */
import { CounterRuntime } from './counter';

export default function Audience() {
  return <CounterRuntime serverEndpoint="/api/audience" />;
}
