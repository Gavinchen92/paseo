import { expect, type Locator, type Page } from "@playwright/test";
import { readScrollMetrics, waitForContentGrowth, expectNearBottom } from "./agent-bottom-anchor";

export async function awaitAssistantMessage(page: Page, hasText?: string | RegExp): Promise<void> {
  const messages = page.getByTestId("assistant-message");
  const target = hasText === undefined ? messages.first() : messages.filter({ hasText }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
}

/**
 * Observes an assistant block that has finished streaming. While later blocks
 * stream below it, its Markdown root must stay the same mounted node with no
 * descendants removed. Re-creating completed blocks on every stream update is
 * what froze Android chats (#1989).
 */
export async function observeCompletedMarkdownBlock(
  page: Page,
  message: Locator,
): Promise<{ expectLaterStreamKeepsMounted(): Promise<void> }> {
  const block = await message.locator(":scope > *").first().elementHandle();
  const root = await message
    .locator(":scope > *")
    .first()
    .locator(":scope > *")
    .first()
    .elementHandle();
  if (!block || !root) {
    throw new Error("Expected the completed assistant block to contain a Markdown root");
  }
  await page.evaluate((observed) => {
    const evidence = { removedNodes: 0 };
    const observer = new MutationObserver((records) => {
      for (const record of records) evidence.removedNodes += record.removedNodes.length;
    });
    observer.observe(observed, { childList: true, subtree: true });
    Object.assign(window, {
      __completedMarkdownEvidence: evidence,
      __completedMarkdownObserver: observer,
    });
  }, block);

  return {
    async expectLaterStreamKeepsMounted() {
      const { contentHeight } = await readScrollMetrics(page);
      await waitForContentGrowth(page, contentHeight + 200);
      const evidence = await page.evaluate(
        ([observedBlock, observedRoot]) => {
          const state = window as typeof window & {
            __completedMarkdownEvidence?: { removedNodes: number };
            __completedMarkdownObserver?: MutationObserver;
          };
          state.__completedMarkdownObserver?.disconnect();
          return {
            connected: observedRoot.isConnected,
            sameRoot: observedBlock.firstElementChild === observedRoot,
            removedNodes: state.__completedMarkdownEvidence?.removedNodes,
          };
        },
        [block, root] as const,
      );
      expect(evidence).toEqual({ connected: true, sameRoot: true, removedNodes: 0 });
    },
  };
}

export async function awaitToolCall(page: Page, toolName: string | RegExp): Promise<void> {
  await expect(
    page.getByTestId("tool-call-badge").filter({ hasText: toolName }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

export async function expectAgentIdle(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByRole("button", { name: /stop|cancel/i })).toHaveCount(0, { timeout });
}

// The working indicator is an animated spinner View — no semantic ARIA role, testId is correct.
export async function expectInlineWorkingIndicator(page: Page): Promise<void> {
  await expect(page.getByTestId("turn-working-indicator")).toBeVisible({ timeout: 30_000 });
}

export async function expectRunningAgentChrome(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("button", { name: title, exact: true });

  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByRole("progressbar", { name: "Agent running" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toBeVisible({
    timeout: 30_000,
  });
  await expectInlineWorkingIndicator(page);
}

export async function expectAgentReadyToInterrupt(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Canceling agent", exact: true })).toHaveCount(0);
}

export async function expectVisibleAgentSurfacesIdle(page: Page): Promise<void> {
  const visibleAgentTab = page
    .getByTestId(/^workspace-tab-agent_/)
    .filter({ visible: true })
    .first();

  await expect(visibleAgentTab).toBeVisible({ timeout: 30_000 });
  await expect(visibleAgentTab.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toHaveCount(0);
  await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
  await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
}

export async function expectAgentSurfacesIdle(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("button", { name: title, exact: true });

  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toHaveCount(0);
  await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
  await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
  await expectTurnCopyButton(page);
}

export async function expectTurnCopyButton(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Copy turn" }).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function expectScrollFollowsNewContent(page: Page): Promise<void> {
  const { contentHeight } = await readScrollMetrics(page);
  await waitForContentGrowth(page, contentHeight);
  await expectNearBottom(page);
}
