import MagicString from "magic-string";
import builtinGenerators from "./generators";
import { GenerateContext, GenerateResult } from "./generator";
import { Block, findBlocks, parseRawArgs } from "./_parse";
import { Config, ResolvedConfig, resolveConfig } from "./config";

export interface TransformResult {
  hasChanged: boolean;
  hasIssues: boolean;
  contents: string;
  updates: { block: Block; result: GenerateResult }[];
  time: number;
}

export async function transform(
  contents: string,
  _config?: Config,
): Promise<TransformResult> {
  const start = performance.now();
  const config = resolveConfig(_config);

  const editor = new MagicString(contents);

  const updates: TransformResult["updates"] = [];

  const generators = {
    ...builtinGenerators,
    ...config.generators,
  };

  const blocks = findBlocks(contents);

  for (const block of blocks) {
    const result = await _transformBlock(block, config, generators);
    updates.push({ block, result });
    editor.overwrite(
      block.loc.start,
      block.loc.end,
      `\n\n${result.contents}\n\n`,
    );
  }

  const hasChanged = editor.hasChanged();
  const hasIssues = updates.some((u) => u.result.issues?.length);
  const time = performance.now() - start;

  return {
    hasChanged,
    hasIssues,
    contents: hasChanged ? editor.toString() : contents,
    updates,
    time,
  };
}

async function _transformBlock(
  block: Block,
  config: ResolvedConfig,
  generators: Record<string, any>,
): Promise<GenerateResult> {
  const args = parseRawArgs(block.rawArgs);
  const generator = generators[block.generator];

  if (!generator) {
    const didYouMean = await import("didyoumean2").then((r) => r.default || r);
    const suggestions = didYouMean(block.generator, Object.keys(generators));
    const error = `Unknown generator:\`${block.generator}\`.${suggestions ? ` Did you mean "generator:\`${suggestions}\`"?` : ""}`;
    return {
      contents: `<!-- ⚠️  ${error} -->`,
      issues: [error],
    };
  }

  const context: GenerateContext = {
    args,
    config,
    block,
    transform: (contents: string) => transform(contents, config),
  };

  try {
    const result = (await generator.generate(context)) as GenerateResult;
    return result;
  } catch (_error: any) {
    const error = `(${block.generator}) ${_error.message || _error}`;
    return {
      contents: `<!-- ⚠️  ${error} -->`,
      issues: [error],
    };
  }
}
