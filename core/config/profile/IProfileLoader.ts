// ProfileHandlers manage the loading of a config, allowing us to abstract over different ways of getting to a OCircuitConfig

import { ConfigResult } from "@opencircuit/config-yaml";
import { OCircuitConfig } from "../../index.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

// After we have the OCircuitConfig, the ConfigHandler takes care of everything else (loading models, lifecycle, etc.)
export interface IProfileLoader {
  description: ProfileDescription;
  doLoadConfig(): Promise<ConfigResult<OCircuitConfig>>;
  setIsActive(isActive: boolean): void;
}
