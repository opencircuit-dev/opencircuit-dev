import { getApiClient } from "../config.js";
import { logger } from "../util/logger.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { ApiClientServiceState, AuthServiceState } from "./types.js";

/**
 * Service for managing API client state
 * Provides access to the Continue SDK API client
 */
export class ApiClientService
  extends BaseService<ApiClientServiceState>
  implements ServiceWithDependencies
{
  constructor() {
    super("ApiClientService", {
      apiClient: null,
    });
  }

  /**
   * Declare dependencies on other services
   */
  getDependencies(): string[] {
    return ["auth"];
  }

  /**
   * Initialize the API client service
   */
  async doInitialize(
    authState: AuthServiceState | null,
  ): Promise<ApiClientServiceState> {
    const apiClient = authState?.apiClient ?? getApiClient(undefined);

    return {
      apiClient,
    };
  }

  /**
   * Update the API client with new auth config
   */
  async update(
    authState: AuthServiceState | null,
  ): Promise<ApiClientServiceState> {
    logger.debug("Updating ApiClientService");

    try {
      const apiClient = authState?.apiClient ?? getApiClient(undefined);

      this.setState({
        apiClient,
      });

      logger.debug("ApiClientService updated successfully");
      return this.getState();
    } catch (error: any) {
      logger.error("Failed to update ApiClientService:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Override isReady to check for API client
   */
  override isReady(): boolean {
    return super.isReady() && this.currentState.apiClient !== null;
  }
}
