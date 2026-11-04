/* /audience — neutral embed for the production viewer counter.
 *
 * This path keeps embedded clients independent from generic counter/viewer URL
 * names while sharing the same rendering, polling, provider handling, fonts,
 * and MultiChat background-control behavior as CounterRuntime.
 */
import { CounterRuntime } from './counter';

export default function Audience() {
  return <CounterRuntime serverEndpoint="/api/audience" />;
}
