import { Box, Text, useStdout } from "ink";
import React, { useEffect, useState } from "react";

import { services } from "../services/index.js";

import { Selector, SelectorOption } from "./Selector.js";

interface ModelOption extends SelectorOption {
  index: number;
  provider: string;
}

interface ModelSelectorProps {
  onSelect: (model: ModelOption) => void;
  onCancel: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  onSelect,
  onCancel,
}) => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentModelIndex, setCurrentModelIndex] = useState<number>(-1);
  const [discoveryWarning, setDiscoveryWarning] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const { stdout } = useStdout();

  useEffect(() => {
    let active = true;
    const updateModels = (resetSelection = false) => {
      const availableModels = services.model.getAvailableChatModels();
      const currentIndex = services.model.getCurrentModelIndex();
      setModels(
        availableModels.map((model) => ({
          id: `${model.provider}-${model.name}-${model.index}`,
          name: model.name,
          index: model.index,
          provider: model.provider,
          displaySuffix: model.discovered ? " (discovered)" : " (configured)",
        })),
      );
      setCurrentModelIndex(currentIndex);
      setSelectedIndex((previous) =>
        resetSelection
          ? Math.max(0, currentIndex)
          : Math.min(previous, Math.max(0, availableModels.length - 1)),
      );
      if (availableModels.length > 0) setLoading(false);
      return availableModels.length;
    };
    const loadModels = async () => {
      try {
        updateModels(true);
        const warning = await services.model.discoverModels();
        if (!active) return;
        setDiscoveryWarning(warning);
        if (updateModels() === 0) {
          setError("No chat models available in the configuration");
        }
      } catch {
        if (!active) return;
        if (services.model.getAvailableChatModels().length > 0) {
          setDiscoveryWarning(
            "Model discovery failed. Configured models remain available.",
          );
        } else {
          setError("Failed to load models");
        }
      } finally {
        if (active) {
          setDiscovering(false);
          setLoading(false);
        }
      }
    };

    void loadModels();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Selector
        title={discovering ? "Select Model (discovering...)" : "Select Model"}
        options={models}
        selectedIndex={selectedIndex}
        loading={loading}
        error={error}
        loadingMessage="Loading available models..."
        maxVisibleOptions={Math.max(3, (stdout.rows || 24) - 12)}
        currentId={
          currentModelIndex >= 0 && models[currentModelIndex]
            ? models[currentModelIndex].id
            : null
        }
        onSelect={onSelect}
        onCancel={onCancel}
        onNavigate={setSelectedIndex}
      />
      {discoveryWarning && (
        <Box>
          <Text color="yellow">{discoveryWarning}</Text>
        </Box>
      )}
    </Box>
  );
};

export { ModelSelector };
