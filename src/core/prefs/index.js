// Prefs barrel: importing this registers every built-in preference with the
// registry. Add a module here and its prefs appear in the settings panel and
// the `settings` catalog command. Mirrors engine/effects/index.js.
import './builtins.js';

export * from './registry.js';
