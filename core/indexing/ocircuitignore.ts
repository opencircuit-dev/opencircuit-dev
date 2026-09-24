import fs from "fs";
import { IDE } from "..";
import { getGlobalOCircuitIgnorePath } from "../util/paths";
import { gitIgArrayFromFile } from "./ignore";

export const getGlobalOCircuitIgArray = () => {
  const contents = fs.readFileSync(getGlobalOCircuitIgnorePath(), "utf8");
  return gitIgArrayFromFile(contents);
};

export const getWorkspaceOCircuitIgArray = async (ide: IDE) => {
  const dirs = await ide.getWorkspaceDirs();
  return await dirs.reduce(
    async (accPromise, dir) => {
      const acc = await accPromise;
      try {
        const contents = await ide.readFile(`${dir}/.ocircuitignore`);
        return [...acc, ...gitIgArrayFromFile(contents)];
      } catch (err) {
        console.error(err);
        return acc;
      }
    },
    Promise.resolve([] as string[]),
  );
};
