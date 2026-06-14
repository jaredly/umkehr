# 02 Feedback: Static Scroll Screenshot Review

## General Findings

- The static-scroll direction is better than the staged controls. It is easier to compare states when they are all visible in the page flow.
- The biggest remaining issue is scale. Several figures are effectively thumbnails in the screenshot, especially 03-06. The page is scrollable now, so the visuals should spend more vertical space and avoid cramming multiple dense panels into one wide SVG.
- Prefer vertical reflow over side-by-side density for explanation-heavy diagrams. On narrower screenshots, three-column layouts make node labels, callouts, and code snippets hard to read.
- Parent-pointer direction is much better after the first feedback pass. Keep reserving arrowheads for semantic parent pointers or clearly labeled non-parent relationships.
- SVG text inside callouts is often too small. Shorten callout copy and increase the effective rendered size rather than relying on dense explanatory text.
- Consider a shared "section row" pattern for compound figures: one state per full-width row, with a short caption on the right or below. This would make the tall diagrams more readable without adding interactivity.

## 01

- Still the strongest figure. The parent tree plus rendered traversal strip reads cleanly.
- Minor: the rendered traversal strip could be slightly larger, but this is not urgent.

## 02

- The before/after vertical stacking works well and matches the requested direction.
- The first-character-to-block parent pointers help.
- The after state still splits `B1` and `B2` side by side. That is okay, but the `d.parent := B2` callout feels detached at the bottom. Move it closer to the first `d` in `B2`, or make `B2`'s block/root target more visually explicit.
- The block labels being plain text targets is a little ambiguous. Consider giving `B1` and `B2` small root/block pills, like figure 01's `block B`, so the upward parent pointer has a concrete destination.

## 03

- The added after tree is the right idea.
- The three-column layout makes all three panels too small. Stack `before tree`, `user intent`, and `naive after tree` vertically, or use two rows with the naive after tree full-width.
- The after tree should get more room; the current dog-stayed-behind bug is visible by color, but the structure and labels are hard to inspect.
- The "user intent" panel uses block text boxes while the neighboring panels use trees. That is acceptable, but label it more explicitly as the user's intended rendered result rather than a structural tree.

## 04

- Rendering all states at once is a clear improvement.
- This figure now needs a better layout pass. The repeated after trees are readable conceptually, but each tree is too small in the screenshot.
- Make each row larger and reduce repeated detail where possible. For example, the final row could emphasize the final `B2: red dog` tree and rendered strip without repeating every surrounding node at the same density.
- The final rendered strip is useful, but it is small and pushed to the right. It should be closer to the tree it explains and large enough to read immediately.

## 05

- The `the red dog` context fix works.
- Showing replica intents plus the LWW result together is good.
- The diagram still reads more like block text cards than a conflict visualization. Add small visual tags or badges for `intentional` and `incidental`, especially on A's `B2: red dog` result, so the reason for the conflict is visible without reading the callout.
- The LWW result panel is clear enough, but could benefit from a stronger visual emphasis on `B3: empty`.

## 06

- This now mirrors 05 much better, but it still needs the most design work.
- The code snippets are too small in the screenshot. Convert the metadata into larger chips/badges where possible: `intentional`, `incidental`, `splitPath: [B1, _, r]`, and `dog.parent := B3`.
- The contrast with 05 should be more explicit. Use the same visual arrangement as 05, then add the tags that explain why the merged result differs.
- The bottom result is correct, but the arrow between `B2` and `B3` is not self-explanatory. Either label it as the intentional split boundary or remove it and let the block states plus callout carry the point.

## 07

- This looks good overall.
- The range bars appear much better aligned than before.
- The resolved spans are a little small. Consider enlarging that strip or adding stronger visual bold styling to the `r` and `_` spans so the result can be read without inspecting labels.

## 08

- Pretty good overall.
- The raw graph and materialized order comparison reads clearly.
- The deterministic tie-break callout is helpful, but it is visually detached below the panels. Consider moving it into the materialized-order panel or tightening the vertical spacing.

## Suggested Next Pass

1. Reflow 03-06 for vertical readability instead of side-by-side density.
2. Increase the apparent size of trees, callouts, and code/metadata text.
3. Replace dense code snippets in 06 with larger semantic tags.
4. Add visual `intentional` / `incidental` markers to 05 and 06.
5. Make block/root targets concrete in 02 so first-character parent pointers land on an object, not just text.
