# 🥬 Veggie Picker - Smart Shopping Suggestions

A beautiful, intelligent vegetable and fruit shopping list generator built with InstantDB.

## Features

### 🏠 Home Screen
- **Generate Shopping Lists**: Click "Generate Today's List" to create a smart suggestion
- **View by Category**: Suggestions are automatically grouped by category (leafy, root, citrus, etc.)
- **Timestamp Tracking**: See when the list was last generated

### 📝 Manage Items Screen
- **Add/Edit Items**: Full CRUD operations for vegetables and fruits
- **Filter & Search**: Filter by type (vegetable/fruit) and category
- **Enable/Disable**: Toggle items on/off without deleting them
- **Track History**: See when each item was last suggested
- **Inline Editing**: Quick edit and delete buttons for each item

### ⚙️ Settings Screen
- **Items per Category**: Configure how many items to suggest from each category (default: 2)
- **Cooldown Days**: Set minimum days before an item can be suggested again (default: 7)
- **Statistics**: View total items, enabled items, and suggestion history

## Suggestion Algorithm

The app uses an intelligent algorithm to generate diverse shopping lists:

1. **Only considers enabled items** - Disabled items are excluded
2. **Groups items by category** - Ensures variety across categories
3. **Selects N items per category** - Configurable in settings
4. **Prioritizes variety**:
   - Items never suggested are picked first
   - Items suggested longest ago are picked next
5. **Respects cooldown period** - Excludes items suggested within X days
6. **Updates tracking** - Records when each item was suggested

This ensures you get diverse, rotating shopping suggestions that avoid repetition!

## Tech Stack

- **InstantDB** - Real-time database with schema, queries, and permissions
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool
- **Modern CSS** - Beautiful gradient UI with smooth animations

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Seed the database with sample items:
   ```bash
   npm run seed
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5173 (or the port shown in terminal)

## Project Structure

```
veggie-picker/
├── src/
│   ├── main.ts           # Main application logic
│   ├── style.css         # Styles
│   ├── instant.schema.ts # InstantDB schema
│   ├── instant.perms.ts  # InstantDB permissions
│   └── lib/
│       └── db.ts         # Database initialization
├── scripts/
│   └── seed.ts           # Database seeding script
├── index.html
└── package.json
```

## Database Schema

### Items
- **name**: string - Item name (e.g., "Spinach")
- **type**: string - "vegetable" or "fruit"
- **category**: string - Category name (e.g., "leafy", "root", "citrus")
- **enabled**: boolean - Whether item is active
- **lastSuggestedAt**: number? - Timestamp of last suggestion
- **createdAt**: number - Creation timestamp

### Suggestions
- **generatedAt**: number - When the suggestion was created
- **items**: link - Many-to-many relationship with items

### Settings
- **itemsPerCategory**: number - Items to suggest per category
- **cooldownDays**: number - Days before item can be suggested again
- **updatedAt**: number - Last update timestamp

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run seed` - Seed database with sample data

## Customization

### Adding More Items

1. Go to "Manage Items" screen
2. Click "+ Add Item"
3. Fill in name, type, and category
4. Item is enabled by default

### Adjusting Suggestion Logic

Go to Settings and modify:
- **Items per Category** - Higher = more items per suggestion
- **Cooldown Days** - Higher = more variety between suggestions

---

Got any feedback or questions? Join the [InstantDB Discord](https://discord.gg/hgVf9R6SBm)

