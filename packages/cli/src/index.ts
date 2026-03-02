// ---------------------------------------------------------------------------
// @guidekit/cli — CLI tools for GuideKit SDK
// ---------------------------------------------------------------------------
//
// Commands:
//   npx guidekit init            — scaffold GuideKit config in a project
//   npx guidekit doctor          — validate API keys and provider connectivity
//   npx guidekit generate-secret — generate a signing secret for JWT tokens
// ---------------------------------------------------------------------------

export { runInit } from './commands/init.js';
export { runDoctor } from './commands/doctor.js';
export { runGenerateSecret } from './commands/generate-secret.js';
export { run } from './cli.js';
