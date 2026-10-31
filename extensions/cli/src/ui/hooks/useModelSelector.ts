import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../../services/index.js";
import { ModelServiceState } from "../../services/types.js";
import { useNavigation } from "../context/NavigationContext.js";

interface ModelOption {
  id: string;
  name: string;
  index: number;
  provider: string;
}

interface UseModelSelectorProps {
  onMessage: (message: {
    role: string;
    content: string;
    messageType: "system";
  }) => void;
  onModelSwitch?: () => void;
  onRefreshUI?: () => void;
}

export function useModelSelector({
  onMessage,
  onModelSwitch,
  onRefreshUI,
}: UseModelSelectorProps) {
  const { closeCurrentScreen } = useNavigation();

  const handleModelSelect = async (model: ModelOption) => {
    closeCurrentScreen();

    try {
      await services.model.switchModel(model.index);
      const modelInfo = services.model.getModelInfo();

      // Update the service container to trigger re-renders
      const currentState = services.model.getState();
      serviceContainer.set<ModelServiceState>(
        SERVICE_NAMES.MODEL,
        currentState,
      );

      let persistenceSuffix = "";
      if (modelInfo?.name) {
        const persistence = await services.config.setSelectedModel(
          modelInfo.name,
        );
        if (!persistence.persisted) {
          persistenceSuffix = " (session only; preference could not be saved)";
        }
      }

      onMessage({
        role: "system",
        content: `Switched to model: ${modelInfo?.name}${persistenceSuffix}`,
        messageType: "system",
      });

      // Trigger any additional actions after model switch
      if (onModelSwitch) {
        onModelSwitch();
      }

      // Force UI refresh to update the IntroMessage with new model
      if (onRefreshUI) {
        onRefreshUI();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      onMessage({
        role: "system",
        content: `Failed to switch model: ${message}`,
        messageType: "system",
      });
    }
  };

  return {
    handleModelSelect,
  };
}
