import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const OBSERVER_DIR = fileURLToPath(new URL("../../../observer/", import.meta.url));
export const MODEL_PROFILES_DIR = fileURLToPath(
  new URL("../../../config/models/", import.meta.url),
);
