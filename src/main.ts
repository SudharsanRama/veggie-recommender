import { id, type InstaQLEntity } from "@instantdb/core";
import type { AppSchema } from "./instant.schema";
import { db } from "./lib/db";
import "./style.css";

type Item = InstaQLEntity<AppSchema, "items">;
type Suggestion = InstaQLEntity<AppSchema, "suggestions", { items: {} }>;
type Settings = InstaQLEntity<AppSchema, "settings">;

// State
let currentScreen: "home" | "manage" | "settings" = "home";
let filterType: string = "all";
let filterCategory: string = "all";

// Initialize settings if not exists
async function initializeSettings() {
  const result = await db.queryOnce({ settings: {} });
  if (result.data.settings.length === 0) {
    await db.transact(
      db.tx.settings[id()].update({
        itemsPerCategory: 2,
        cooldownDays: 7,
        updatedAt: Date.now(),
      })
    );
  }
}

initializeSettings();

// Subscribe to data
db.subscribeQuery(
  {
    items: {},
    suggestions: {
      $: {
        order: { generatedAt: "desc" },
        limit: 1,
      },
      items: {},
    },
    settings: {},
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

// Core suggestion logic
async function generateSuggestions() {
  const result = await db.queryOnce({
    items: {
      $: {
        where: { enabled: true },
      },
    },
    settings: {},
  });
  
  const items = result.data.items;
  const settings = result.data.settings;

  const config = settings[0] || { itemsPerCategory: 2, cooldownDays: 7 };
  const now = Date.now();
  const cooldownMs = config.cooldownDays * 24 * 60 * 60 * 1000;

  // Filter out items in cooldown
  const eligibleItems = items.filter((item: Item) => {
    if (!item.lastSuggestedAt) return true;
    return now - item.lastSuggestedAt > cooldownMs;
  });

  // Group by category
  const itemsByCategory = eligibleItems.reduce((acc: Record<string, Item[]>, item: Item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  // Select items per category
  const selectedItems: Item[] = [];
  Object.values(itemsByCategory).forEach((categoryItems: Item[]) => {
    // Sort by lastSuggestedAt (null first, then oldest first)
    categoryItems.sort((a: Item, b: Item) => {
      if (!a.lastSuggestedAt && !b.lastSuggestedAt) return 0;
      if (!a.lastSuggestedAt) return -1;
      if (!b.lastSuggestedAt) return 1;
      return a.lastSuggestedAt - b.lastSuggestedAt;
    });

    // Take up to N items
    selectedItems.push(...categoryItems.slice(0, config.itemsPerCategory));
  });

  // Create suggestion and link items
  const suggestionId = id();
  const txs: any[] = [
    db.tx.suggestions[suggestionId].update({
      generatedAt: now,
    }),
  ];

  // Update lastSuggestedAt for selected items and link them
  selectedItems.forEach((item) => {
    txs.push(
      db.tx.items[item.id].update({ lastSuggestedAt: now })
    );
    txs.push(
      db.tx.items[item.id].link({ suggestions: suggestionId })
    );
  });

  await db.transact(txs);
}

// Item management
async function addItem(
  name: string,
  type: string,
  category: string,
  enabled: boolean = true
) {
  await db.transact(
    db.tx.items[id()].update({
      name,
      type,
      category,
      enabled,
      createdAt: Date.now(),
    })
  );
}

async function updateItem(item: Item, updates: Partial<Item>) {
  await db.transact(db.tx.items[item.id].update(updates));
}

async function deleteItem(item: Item) {
  await db.transact(db.tx.items[item.id].delete());
}

// Settings management
async function updateSettings(itemsPerCategory: number, cooldownDays: number) {
  const result = await db.queryOnce({ settings: {} });
  const settings = result.data.settings;
  if (settings.length > 0) {
    await db.transact(
      db.tx.settings[settings[0].id].update({
        itemsPerCategory,
        cooldownDays,
        updatedAt: Date.now(),
      })
    );
  }
}

// Render functions
function render(data: {
  items: Item[];
  suggestions: Suggestion[];
  settings: Settings[];
}) {
  const app = document.getElementById("app")!;

  app.innerHTML = `
    <div class="container">
      <header>
        <h1>🥬 Veggie Picker</h1>
        <nav>
          <button class="nav-btn ${currentScreen === "home" ? "active" : ""}" data-screen="home">
            Home
          </button>
          <button class="nav-btn ${currentScreen === "manage" ? "active" : ""}" data-screen="manage">
            Manage Items
          </button>
          <button class="nav-btn ${currentScreen === "settings" ? "active" : ""}" data-screen="settings">
            Settings
          </button>
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

function renderHomeScreen(data: {
  items: Item[];
  suggestions: Suggestion[];
  settings: Settings[];
}) {
  const latestSuggestion = data.suggestions[0];

  if (!latestSuggestion || !latestSuggestion.items) {
    return `
      <div class="home-screen">
        <div class="empty-state">
          <div class="icon">🛒</div>
          <h2>No suggestions yet</h2>
          <p>Generate your first shopping list to get started!</p>
          <button class="btn-primary btn-generate">
            Generate Today's List
          </button>
        </div>
      </div>
    `;
  }

  const itemsByCategory = latestSuggestion.items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  return `
    <div class="home-screen">
      <div class="suggestion-header">
        <div>
          <h2>Today's Shopping List</h2>
          <p class="timestamp">Generated ${new Date(latestSuggestion.generatedAt).toLocaleString()}</p>
        </div>
        <button class="btn-primary btn-generate">
          Regenerate List
        </button>
      </div>

      <div class="suggestions-grid">
        ${Object.entries(itemsByCategory)
          .map(
            ([category, items]) => `
          <div class="category-card">
            <h3>${capitalizeFirst(category)}</h3>
            <ul class="item-list">
              ${items.map((item) => `<li><span class="item-type-badge ${item.type}">${item.type === "vegetable" ? "🥕" : "🍎"}</span> ${item.name}</li>`).join("")}
            </ul>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderManageScreen(data: {
  items: Item[];
  suggestions: Suggestion[];
  settings: Settings[];
}) {
  const filteredItems = data.items.filter((item) => {
    if (filterType !== "all" && item.type !== filterType) return false;
    if (filterCategory !== "all" && item.category !== filterCategory)
      return false;
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
              <th>Name</th>
              <th>Type</th>
              <th>Category</th>
              <th>Last Suggested</th>
              <th>Status</th>
              <th>Actions</th>
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
              </tr>
            `
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

        <label>
          Category
          <input type="text" id="item-category" required placeholder="e.g., leafy, root, citrus">
        </label>

        <div class="dialog-actions">
          <button type="button" class="btn-secondary" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </dialog>
  `;
}

function renderSettingsScreen(data: {
  items: Item[];
  suggestions: Suggestion[];
  settings: Settings[];
}) {
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

function attachEventListeners(data: {
  items: Item[];
  suggestions: Suggestion[];
  settings: Settings[];
}) {
  // Navigation
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      currentScreen = target.dataset.screen as any;
      render(data); // Re-render to show the new screen
    });
  });

  // Home screen
  const generateBtn = document.querySelector(".btn-generate");
  if (generateBtn) {
    generateBtn.addEventListener("click", () => generateSuggestions());
  }

  // Manage screen
  if (currentScreen === "manage") {
    const addBtn = document.getElementById("add-item-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => showItemDialog());
    }

    document.getElementById("filter-type")?.addEventListener("change", (e) => {
      filterType = (e.target as HTMLSelectElement).value;
      render(data); // Re-render to apply filter
    });

    document
      .getElementById("filter-category")
      ?.addEventListener("change", (e) => {
        filterCategory = (e.target as HTMLSelectElement).value;
        render(data); // Re-render to apply filter
      });

    document.querySelectorAll(".toggle-enabled").forEach((toggle) => {
      toggle.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        const itemId = target.dataset.itemId!;
        const item = data.items.find((i) => i.id === itemId)!;
        updateItem(item, { enabled: target.checked });
      });
    });

    document.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const itemId = target.dataset.itemId!;
        const item = data.items.find((i) => i.id === itemId)!;
        showItemDialog(item);
      });
    });

    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const itemId = target.dataset.itemId!;
        const item = data.items.find((i) => i.id === itemId)!;
        if (confirm(`Delete ${item.name}?`)) {
          deleteItem(item);
        }
      });
    });

    const dialog = document.getElementById("item-dialog") as HTMLDialogElement;
    const form = document.getElementById("item-form");
    const cancelBtn = document.getElementById("cancel-btn");

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => dialog.close());
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const editId = (
          document.getElementById("edit-item-id") as HTMLInputElement
        ).value;
        const name = (document.getElementById("item-name") as HTMLInputElement)
          .value;
        const type = (
          document.getElementById("item-type") as HTMLSelectElement
        ).value;
        const category = (
          document.getElementById("item-category") as HTMLInputElement
        ).value;

        if (editId) {
          const item = data.items.find((i) => i.id === editId)!;
          await updateItem(item, { name, type, category });
        } else {
          await addItem(name, type, category);
        }

        dialog.close();
      });
    }
  }

  // Settings screen
  if (currentScreen === "settings") {
    const settingsForm = document.getElementById("settings-form");
    if (settingsForm) {
      settingsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const itemsPerCategory = parseInt(
          (
            document.getElementById("items-per-category") as HTMLInputElement
          ).value
        );
        const cooldownDays = parseInt(
          (document.getElementById("cooldown-days") as HTMLInputElement).value
        );
        await updateSettings(itemsPerCategory, cooldownDays);
        alert("Settings saved!");
      });
    }
  }
}

function showItemDialog(item?: Item) {
  const dialog = document.getElementById("item-dialog") as HTMLDialogElement;
  const title = document.getElementById("dialog-title")!;
  const editId = document.getElementById("edit-item-id") as HTMLInputElement;
  const nameInput = document.getElementById("item-name") as HTMLInputElement;
  const typeInput = document.getElementById("item-type") as HTMLSelectElement;
  const categoryInput = document.getElementById(
    "item-category"
  ) as HTMLInputElement;

  if (item) {
    title.textContent = "Edit Item";
    editId.value = item.id;
    nameInput.value = item.name;
    typeInput.value = item.type;
    categoryInput.value = item.category;
  } else {
    title.textContent = "Add Item";
    editId.value = "";
    nameInput.value = "";
    typeInput.value = "vegetable";
    categoryInput.value = "";
  }

  dialog.showModal();
}

function capitalizeFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderError(message: string) {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="error">
      <h2>Error</h2>
      <p>${message}</p>
    </div>
  `;
}
