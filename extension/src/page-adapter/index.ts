/*
 * MAIN-world entry.
 *
 * The site bridge and its closed command protocol live in bridge.ts. This entry
 * exists so the dynamically registered MAIN content script stays a single,
 * stable build input. Nothing here exposes chrome APIs, page globals, or a
 * generic command forwarder.
 */

import "./bridge.js";
