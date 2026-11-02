import { Desktop } from "@mediar-ai/terminator";
import * as Terminator from "@mediar-ai/terminator";

const desktop = new Desktop();
const tree = await desktop.getWindowTreeResult("Code", undefined, {
  formatOutput: true,
  treeOutputFormat: Terminator.TreeOutputFormat.CompactYaml,
  propertyMode: Terminator.PropertyLoadingMode.Complete,
});

console.log(tree.formatted?.slice(600));
