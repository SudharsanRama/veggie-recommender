import { id, type InstaQLEntity } from "@instantdb/core";
import type { AppSchema } from "./instant.schema";
import { db } from "./lib/db";
import "./style.css";

type Item = InstaQLEntity<AppSchema, "items">;
type Suggestion = InstaQLEntity<AppSchema, "suggestions", { items: {} }>;
type Settings = InstaQLEntity<AppSchema, "settings">;

const SESSION_KEY = "veggie_session_id";
const SESSION_TTL_DAYS = 30;
const FRUIT_CATEGORY = "produce";

// UI state
let currentScreen: "home" | "manage" | "settings" = "home";
let filterType: string = "all";
let filterCategory: string = "all";

// Session state — set during bootstrap before any DB writes
let currentDbSessionId: string;

function getLocalSessionId(): string {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = id();
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

const localSessionId = getLocalSessionId();

async function initSession(): Promise<string> {
  const result = await db.queryOnce({
    sessions: { $: { where: { sessionId: localSessionId } } },
  });

  const now = Date.now();

  if (result.data.sessions.length > 0) {
    const session = result.data.sessions[0];
    await db.transact(db.tx.sessions[session.id].update({ lastVisitedAt: now }));
    return session.id;
  }

  const sessionDbId = id();
  await db.transact(
    db.tx.sessions[sessionDbId].update({ sessionId: localSessionId, lastVisitedAt: now })
  );
  return sessionDbId;
}

async function cleanupOldSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.queryOnce({
    sessions: { $: { where: { lastVisitedAt: { $lt: cutoff } } } },
  });
  const old = result.data?.sessions ?? [];
  if (old.length === 0) return;
  await db.transact(old.map((s) => db.tx.sessions[s.id].delete()));
}

async function initializeSettings(): Promise<void> {
  const result = await db.queryOnce({
    settings: { $: { where: { "session.sessionId": localSessionId } } },
  });
  if (result.data.settings.length === 0) {
    const settingsId = id();
    await db.transact([
      db.tx.settings[settingsId].update({
        itemsPerCategory: 2,
        cooldownDays: 7,
        updatedAt: Date.now(),
      }),
      db.tx.settings[settingsId].link({ session: currentDbSessionId }),
    ]);
  }
}

function subscribeToData(): void {
  db.subscribeQuery(
    {
      items: { $: { where: { "session.sessionId": localSessionId } } },
      suggestions: {
        $: {
          where: { "session.sessionId": localSessionId },
          order: { generatedAt: "desc" },
        },
        items: {},
      },
      settings: { $: { where: { "session.sessionId": localSessionId } } },
    },
    (resp) => {
      if (resp.error) {
        renderError(resp.error.message);
        return;
      }
      if (resp.data) {
        render(resp.data);
      }
    }
  );
}

async function bootstrap(): Promise<void> {
  renderLoading();
  currentDbSessionId = await initSession();
  cleanupOldSessions().catch(console.error);
  await initializeSettings();
  subscribeToData();
}

bootstrap();

// Core suggestion logic
async function generateSuggestions() {
  const result = await db.queryOnce({
    items: { $: { where: { "session.sessionId": localSessionId } } },
    settings: { $: { where: { "session.sessionId": localSessionId } } },
  });

  const items = result.data.items.filter((item: Item) => item.enabled);
  const settings = result.data.settings;
  const config = settings[0] || { itemsPerCategory: 2, cooldownDays: 7 };
  const now = Date.now();
  const cooldownMs = config.cooldownDays * 24 * 60 * 60 * 1000;

  let eligibleItems = items.filter((item: Item) => {
    if (!item.lastSuggestedAt) return true;
    return now - Number(item.lastSuggestedAt) > cooldownMs;
  });

  // Nothing eligible — reset cooldowns from the most recent suggestion so
  // the user always gets a list (small libraries exhaust the cooldown pool fast)
  if (eligibleItems.length === 0 && items.length > 0) {
    const latest = await db.queryOnce({
      suggestions: {
        $: {
          where: { "session.sessionId": localSessionId },
          order: { generatedAt: "desc" },
          limit: 1,
        },
        items: {},
      },
    });
    const recent = latest.data?.suggestions?.[0];
    if (recent) {
      const resetTxs: any[] = [db.tx.suggestions[recent.id].delete()];
      for (const item of recent.items || []) {
        resetTxs.push(db.tx.items[item.id].update({ lastSuggestedAt: null } as any));
      }
      await db.transact(resetTxs);
    }
    eligibleItems = items; // full pool is now eligible
  }

  const itemsByCategory = eligibleItems.reduce(
    (acc: Record<string, Item[]>, item: Item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, Item[]>
  );

  const selectedItems: Item[] = [];
  Object.values(itemsByCategory).forEach((categoryItems: Item[]) => {
    categoryItems.sort((a: Item, b: Item) => {
      if (!a.lastSuggestedAt && !b.lastSuggestedAt) return 0;
      if (!a.lastSuggestedAt) return -1;
      if (!b.lastSuggestedAt) return 1;
      return Number(a.lastSuggestedAt) - Number(b.lastSuggestedAt);
    });
    selectedItems.push(...categoryItems.slice(0, config.itemsPerCategory));
  });

  const suggestionId = id();
  const txs: any[] = [
    db.tx.suggestions[suggestionId].update({ generatedAt: now }),
    db.tx.suggestions[suggestionId].link({ session: currentDbSessionId }),
  ];

  selectedItems.forEach((item) => {
    txs.push(db.tx.items[item.id].update({ lastSuggestedAt: now }));
    txs.push(db.tx.items[item.id].link({ suggestions: suggestionId }));
  });

  await db.transact(txs);
}

async function deleteSuggestion(suggestion: Suggestion, allSuggestions: Suggestion[]) {
  const remaining = allSuggestions.filter((s) => s.id !== suggestion.id);
  const txs: any[] = [db.tx.suggestions[suggestion.id].delete()];

  for (const item of suggestion.items || []) {
    const otherSuggestions = remaining.filter((s) =>
      s.items?.some((i) => i.id === item.id)
    );
    if (otherSuggestions.length === 0) {
      txs.push(db.tx.items[item.id].update({ lastSuggestedAt: null } as any));
    } else {
      const mostRecent = Math.max(...otherSuggestions.map((s) => Number(s.generatedAt)));
      txs.push(db.tx.items[item.id].update({ lastSuggestedAt: mostRecent }));
    }
  }

  await db.transact(txs);
}

// Item management
async function addItem(name: string, type: string, category: string, enabled = true) {
  const itemId = id();
  await db.transact([
    db.tx.items[itemId].update({ name, type, category, enabled, createdAt: Date.now() }),
    db.tx.items[itemId].link({ session: currentDbSessionId }),
  ]);
}

async function updateItem(item: Item, updates: Partial<Item>) {
  await db.transact(db.tx.items[item.id].update(updates));
}

async function deleteItem(item: Item) {
  await db.transact(db.tx.items[item.id].delete());
}

async function updateSettings(itemsPerCategory: number, cooldownDays: number) {
  const result = await db.queryOnce({
    settings: { $: { where: { "session.sessionId": localSessionId } } },
  });
  const settings = result.data.settings;
  if (settings.length > 0) {
    await db.transact(
      db.tx.settings[settings[0].id].update({ itemsPerCategory, cooldownDays, updatedAt: Date.now() })
    );
  }
}

function updateCategoryGroupVisibility(type: string) {
  const group = document.getElementById("category-group");
  const select = document.getElementById("item-category") as HTMLSelectElement | null;
  if (!group || !select) return;
  if (type === "fruit") {
    group.classList.add("hidden");
    select.removeAttribute("required");
  } else {
    group.classList.remove("hidden");
    select.setAttribute("required", "");
  }
}

// Render functions
function renderLoading() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="loading-screen">
      <div class="loading-spinner"></div>
      <p>Loading your garden...</p>
    </div>
  `;
}

function render(data: { items: Item[]; suggestions: Suggestion[]; settings: Settings[] }) {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <div class="container">
      <header>
        <h1>🥬 Veggie Picker</h1>
        <nav>
          <button class="nav-btn ${currentScreen === "home" ? "active" : ""}" data-screen="home">Home</button>
          <button class="nav-btn ${currentScreen === "manage" ? "active" : ""}" data-screen="manage">Manage Items</button>
          <button class="nav-btn ${currentScreen === "settings" ? "active" : ""}" data-screen="settings">Settings</button>
        </nav>
      </header>
      <main>
        ${
          currentScreen === "home"
            ? renderHomeScreen(data)
            : currentScreen === "manage"
            ? renderManageScreen(data)
            : renderSettingsScreen(data)
        }
      </main>
    </div>
  `;

  attachEventListeners(data);
}

function renderHomeScreen(data: { items: Item[]; suggestions: Suggestion[]; settings: Settings[] }) {
  if (data.items.length === 0) {
    return `
      <div class="home-screen">
        <div class="onboarding">
          <div class="onboarding-hero">
            <div class="onboarding-icon">🥬</div>
            <h2>Welcome to Veggie Picker</h2>
            <p class="onboarding-subtitle">Your personal produce planner — get a fresh, varied shopping list every week without the mental load.</p>
          </div>
          <div class="onboarding-features">
            <div class="feature-card">
              <span class="feature-icon">🔄</span>
              <div>
                <strong>Smart rotation</strong>
                <p>Items on cooldown are skipped so you're never buying the same thing two weeks running.</p>
              </div>
            </div>
            <div class="feature-card">
              <span class="feature-icon">🗂️</span>
              <div>
                <strong>Category-aware</strong>
                <p>Picks a balanced spread across leafy greens, roots, fruits, and more.</p>
              </div>
            </div>
            <div class="feature-card">
              <span class="feature-icon">✏️</span>
              <div>
                <strong>Fully yours</strong>
                <p>Add, remove, or disable anything. The list reflects exactly what you like.</p>
              </div>
            </div>
          </div>
          <button class="btn-primary btn-get-started">Add Your First Items →</button>
        </div>
      </div>
    `;
  }

  const [latest, ...past] = data.suggestions;

  if (!latest || !latest.items?.length) {
    return `
      <div class="home-screen">
        <div class="empty-state">
          <div class="icon">🛒</div>
          <h2>Ready to go!</h2>
          <p>You have ${data.items.length} item${data.items.length === 1 ? "" : "s"} in your list. Generate your first shopping list whenever you're ready.</p>
          <button class="btn-primary btn-generate">Generate Today's List</button>
        </div>
      </div>
    `;
  }

  const itemsByCategory = latest.items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  return `
    <div class="home-screen">
      <div class="suggestion-header">
        <div>
          <h2>Today's Shopping List</h2>
          <p class="timestamp">Generated ${new Date(latest.generatedAt).toLocaleString()}</p>
        </div>
        <div class="suggestion-header-actions">
          <button class="btn-primary btn-generate">Regenerate</button>
          <button class="btn-danger btn-delete-suggestion" data-suggestion-id="${latest.id}">Delete List</button>
        </div>
      </div>
      <div class="suggestions-grid">
        ${Object.entries(itemsByCategory)
          .map(([category, items]) => `
            <div class="category-card">
              <h3>${capitalizeFirst(category)}</h3>
              <ul class="item-list">
                ${items.map((item) => `<li><span class="item-type-badge ${item.type}">${item.type === "vegetable" ? "🥕" : "🍎"}</span> ${item.name}</li>`).join("")}
              </ul>
            </div>`)
          .join("")}
      </div>

      ${past.length > 0 ? `
        <div class="history-section">
          <h3>History</h3>
          <div class="history-list">
            ${past.map((s) => `
              <div class="history-row">
                <div class="history-info">
                  <span class="history-date">${new Date(s.generatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                  <span class="history-items">${s.items?.length ?? 0} item${(s.items?.length ?? 0) === 1 ? "" : "s"}</span>
                </div>
                <button class="btn-danger btn-delete-suggestion" data-suggestion-id="${s.id}">Delete</button>
              </div>`).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderManageScreen(data: { items: Item[]; suggestions: Suggestion[]; settings: Settings[] }) {
  const filteredItems = data.items.filter((item) => {
    if (filterType !== "all" && item.type !== filterType) return false;
    if (filterCategory !== "all" && item.category !== filterCategory) return false;
    return true;
  });

  const categories = [...new Set(data.items.map((item) => item.category))];

  return `
    <div class="manage-screen">
      <div class="manage-header">
        <h2>Manage Items</h2>
        <button class="btn-primary" id="add-item-btn">+ Add Item</button>
      </div>

      <div class="filters">
        <select class="filter-select" id="filter-type">
          <option value="all">All Types</option>
          <option value="vegetable" ${filterType === "vegetable" ? "selected" : ""}>Vegetables</option>
          <option value="fruit" ${filterType === "fruit" ? "selected" : ""}>Fruits</option>
        </select>
        <select class="filter-select" id="filter-category">
          <option value="all">All Categories</option>
          ${categories.map((cat) => `<option value="${cat}" ${filterCategory === cat ? "selected" : ""}>${capitalizeFirst(cat)}</option>`).join("")}
        </select>
      </div>

      <div class="items-table">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Type</th><th>Category</th><th>Last Suggested</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filteredItems.length === 0 ? `<tr><td colspan="6" class="empty-row">No items found. Add your first item!</td></tr>` : ""}
            ${filteredItems
              .map(
                (item) => `
              <tr>
                <td><strong>${item.name}</strong></td>
                <td><span class="item-type-badge ${item.type}">${item.type === "vegetable" ? "🥕" : "🍎"} ${capitalizeFirst(item.type)}</span></td>
                <td>${capitalizeFirst(item.category)}</td>
                <td>${item.lastSuggestedAt ? new Date(item.lastSuggestedAt).toLocaleDateString() : "Never"}</td>
                <td>
                  <label class="toggle">
                    <input type="checkbox" ${item.enabled ? "checked" : ""} data-item-id="${item.id}" class="toggle-enabled">
                    <span class="slider"></span>
                  </label>
                </td>
                <td>
                  <button class="btn-icon btn-edit" data-item-id="${item.id}">✏️</button>
                  <button class="btn-icon btn-delete" data-item-id="${item.id}">🗑️</button>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <dialog id="item-dialog">
      <form id="item-form">
        <h3 id="dialog-title">Add Item</h3>
        <input type="hidden" id="edit-item-id">
        <label>
          Name
          <input type="text" id="item-name" required placeholder="e.g., Spinach">
        </label>
        <label>
          Type
          <select id="item-type" required>
            <option value="vegetable">Vegetable</option>
            <option value="fruit">Fruit</option>
          </select>
        </label>
        <div class="category-group" id="category-group">
          <div class="category-label-row">
            <span class="field-label">Category</span>
            <div class="help-wrapper">
              <button type="button" class="btn-help" id="category-help-btn">?</button>
              <div class="category-help-popup hidden" id="category-help-popup">
                <div class="help-item"><strong>Bulbs</strong><span>Fleshy base — garlic, onion, leek</span></div>
                <div class="help-item"><strong>Flowers</strong><span>Edible heads — broccoli, cauliflower</span></div>
                <div class="help-item"><strong>Fruits</strong><span>Fleshy with seeds — tomatoes, capsicum, cucumber</span></div>
                <div class="help-item"><strong>Fungi</strong><span>Mushrooms — button, shiitake, oyster</span></div>
                <div class="help-item"><strong>Leaves</strong><span>Leafy parts — spinach, lettuce, cabbage</span></div>
                <div class="help-item"><strong>Roots</strong><span>Taproots — carrots, beetroot, radish</span></div>
                <div class="help-item"><strong>Seeds</strong><span>Legumes — beans, peas, corn</span></div>
                <div class="help-item"><strong>Stems</strong><span>Edible stalks — asparagus, celery</span></div>
                <div class="help-item"><strong>Tubers</strong><span>Underground — potatoes, kumara, yam</span></div>
              </div>
            </div>
          </div>
          <select id="item-category" required>
            <option value="">Select a category...</option>
            <option value="bulbs">Bulbs</option>
            <option value="flowers">Flowers</option>
            <option value="fruits">Fruits</option>
            <option value="fungi">Fungi</option>
            <option value="leaves">Leaves</option>
            <option value="roots">Roots</option>
            <option value="seeds">Seeds</option>
            <option value="stems">Stems</option>
            <option value="tubers">Tubers</option>
          </select>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn-secondary" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </dialog>
  `;
}

function renderSettingsScreen(data: { items: Item[]; suggestions: Suggestion[]; settings: Settings[] }) {
  const settings = data.settings[0] || { itemsPerCategory: 2, cooldownDays: 7 };

  return `
    <div class="settings-screen">
      <h2>Settings</h2>
      <form id="settings-form" class="settings-form">
        <div class="setting-group">
          <label>
            <span class="label-text">Items per Category</span>
            <span class="label-desc">How many items to suggest from each category</span>
            <input type="number" id="items-per-category" value="${settings.itemsPerCategory}" min="1" max="10" required>
          </label>
        </div>
        <div class="setting-group">
          <label>
            <span class="label-text">Cooldown Days</span>
            <span class="label-desc">Minimum days before an item can be suggested again</span>
            <input type="number" id="cooldown-days" value="${settings.cooldownDays}" min="0" max="30" required>
          </label>
        </div>
        <button type="submit" class="btn-primary">Save Settings</button>
      </form>

      <div class="stats">
        <h3>Statistics</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${data.items.length}</div>
            <div class="stat-label">Total Items</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${data.items.filter((i) => i.enabled).length}</div>
            <div class="stat-label">Enabled Items</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${data.suggestions.length}</div>
            <div class="stat-label">Total Suggestions</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachEventListeners(data: { items: Item[]; suggestions: Suggestion[]; settings: Settings[] }) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentScreen = (e.target as HTMLElement).dataset.screen as typeof currentScreen;
      render(data);
    });
  });

  document.querySelector(".btn-get-started")?.addEventListener("click", () => {
    currentScreen = "manage";
    render(data);
  });

  document.querySelector(".btn-generate")?.addEventListener("click", () => generateSuggestions());

  document.querySelectorAll(".btn-delete-suggestion").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const suggestionId = (e.currentTarget as HTMLElement).dataset.suggestionId!;
      const suggestion = data.suggestions.find((s) => s.id === suggestionId)!;
      if (confirm("Delete this list? Items in it will be eligible for re-suggestion.")) {
        deleteSuggestion(suggestion, data.suggestions);
      }
    });
  });

  if (currentScreen === "manage") {
    document.getElementById("add-item-btn")?.addEventListener("click", () => showItemDialog());

    document.getElementById("filter-type")?.addEventListener("change", (e) => {
      filterType = (e.target as HTMLSelectElement).value;
      render(data);
    });

    document.getElementById("filter-category")?.addEventListener("change", (e) => {
      filterCategory = (e.target as HTMLSelectElement).value;
      render(data);
    });

    document.querySelectorAll(".toggle-enabled").forEach((toggle) => {
      toggle.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        const item = data.items.find((i) => i.id === target.dataset.itemId)!;
        updateItem(item, { enabled: target.checked });
      });
    });

    document.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const itemId = (e.target as HTMLElement).dataset.itemId!;
        showItemDialog(data.items.find((i) => i.id === itemId)!);
      });
    });

    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const itemId = (e.target as HTMLElement).dataset.itemId!;
        const item = data.items.find((i) => i.id === itemId)!;
        if (confirm(`Delete ${item.name}?`)) deleteItem(item);
      });
    });

    const dialog = document.getElementById("item-dialog") as HTMLDialogElement;
    document.getElementById("cancel-btn")?.addEventListener("click", () => dialog.close());

    document.getElementById("item-type")?.addEventListener("change", (e) => {
      updateCategoryGroupVisibility((e.target as HTMLSelectElement).value);
    });

    const helpBtn = document.getElementById("category-help-btn");
    const helpPopup = document.getElementById("category-help-popup");
    helpBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      helpPopup?.classList.toggle("hidden");
      if (!helpPopup?.classList.contains("hidden")) {
        document.addEventListener("click", () => helpPopup?.classList.add("hidden"), { once: true });
      }
    });

    document.getElementById("item-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const editId = (document.getElementById("edit-item-id") as HTMLInputElement).value;
      const name = (document.getElementById("item-name") as HTMLInputElement).value;
      const type = (document.getElementById("item-type") as HTMLSelectElement).value;
      const category = type === "fruit"
        ? FRUIT_CATEGORY
        : (document.getElementById("item-category") as HTMLSelectElement).value;

      if (editId) {
        await updateItem(data.items.find((i) => i.id === editId)!, { name, type, category });
      } else {
        await addItem(name, type, category);
      }
      dialog.close();
    });
  }

  if (currentScreen === "settings") {
    document.getElementById("settings-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const itemsPerCategory = parseInt((document.getElementById("items-per-category") as HTMLInputElement).value);
      const cooldownDays = parseInt((document.getElementById("cooldown-days") as HTMLInputElement).value);
      await updateSettings(itemsPerCategory, cooldownDays);
      alert("Settings saved!");
    });
  }
}

function showItemDialog(item?: Item) {
  const dialog = document.getElementById("item-dialog") as HTMLDialogElement;
  (document.getElementById("dialog-title")!).textContent = item ? "Edit Item" : "Add Item";
  (document.getElementById("edit-item-id") as HTMLInputElement).value = item?.id ?? "";
  (document.getElementById("item-name") as HTMLInputElement).value = item?.name ?? "";

  const type = item?.type ?? "vegetable";
  (document.getElementById("item-type") as HTMLSelectElement).value = type;

  updateCategoryGroupVisibility(type);

  if (type !== "fruit") {
    (document.getElementById("item-category") as HTMLSelectElement).value = item?.category ?? "";
  }

  dialog.showModal();
}

function capitalizeFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderError(message: string) {
  document.getElementById("app")!.innerHTML = `
    <div class="error">
      <h2>Error</h2>
      <p>${message}</p>
    </div>
  `;
}
