// Single source of truth for the app version. The release workflow rewrites
// this line from the git tag before compiling the binaries.
export const VERSION = "0.1.0";

/** GitHub repo the auto-updater pulls releases from (owner/name). */
export const UPDATE_REPO = process.env.RADAR_UPDATE_REPO ?? "talent620/useme";
