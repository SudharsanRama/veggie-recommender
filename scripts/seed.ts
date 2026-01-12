import { init, id } from "@instantdb/admin";
import schema from "../src/instant.schema.js";

const adminDb = init({
  appId: "6529fc32-29fa-41a7-83eb-2c8df61f49ed",
  adminToken: "4384e2c5-5b68-44bc-b2ff-bba123bb84fe",
  schema,
});

const vegetables = [
  // Leafy greens
  { name: "Spinach", type: "vegetable", category: "leafy" },
  { name: "Kale", type: "vegetable", category: "leafy" },
  { name: "Lettuce", type: "vegetable", category: "leafy" },
  { name: "Arugula", type: "vegetable", category: "leafy" },
  { name: "Swiss Chard", type: "vegetable", category: "leafy" },
  
  // Root vegetables
  { name: "Carrots", type: "vegetable", category: "root" },
  { name: "Potatoes", type: "vegetable", category: "root" },
  { name: "Sweet Potatoes", type: "vegetable", category: "root" },
  { name: "Beets", type: "vegetable", category: "root" },
  { name: "Turnips", type: "vegetable", category: "root" },
  { name: "Radishes", type: "vegetable", category: "root" },
  
  // Cruciferous
  { name: "Broccoli", type: "vegetable", category: "cruciferous" },
  { name: "Cauliflower", type: "vegetable", category: "cruciferous" },
  { name: "Brussels Sprouts", type: "vegetable", category: "cruciferous" },
  { name: "Cabbage", type: "vegetable", category: "cruciferous" },
  
  // Alliums
  { name: "Onions", type: "vegetable", category: "allium" },
  { name: "Garlic", type: "vegetable", category: "allium" },
  { name: "Shallots", type: "vegetable", category: "allium" },
  { name: "Leeks", type: "vegetable", category: "allium" },
  
  // Peppers
  { name: "Bell Peppers", type: "vegetable", category: "pepper" },
  { name: "Jalapeños", type: "vegetable", category: "pepper" },
  { name: "Chili Peppers", type: "vegetable", category: "pepper" },
  
  // Squash
  { name: "Zucchini", type: "vegetable", category: "squash" },
  { name: "Butternut Squash", type: "vegetable", category: "squash" },
  { name: "Pumpkin", type: "vegetable", category: "squash" },
  
  // Other vegetables
  { name: "Tomatoes", type: "vegetable", category: "nightshade" },
  { name: "Eggplant", type: "vegetable", category: "nightshade" },
  { name: "Cucumbers", type: "vegetable", category: "gourd" },
  { name: "Green Beans", type: "vegetable", category: "legume" },
  { name: "Peas", type: "vegetable", category: "legume" },
  { name: "Asparagus", type: "vegetable", category: "stalk" },
  { name: "Celery", type: "vegetable", category: "stalk" },
  { name: "Mushrooms", type: "vegetable", category: "fungi" },
];

const fruits = [
  // Berries
  { name: "Strawberries", type: "fruit", category: "berry" },
  { name: "Blueberries", type: "fruit", category: "berry" },
  { name: "Raspberries", type: "fruit", category: "berry" },
  { name: "Blackberries", type: "fruit", category: "berry" },
  
  // Citrus
  { name: "Oranges", type: "fruit", category: "citrus" },
  { name: "Lemons", type: "fruit", category: "citrus" },
  { name: "Limes", type: "fruit", category: "citrus" },
  { name: "Grapefruits", type: "fruit", category: "citrus" },
  { name: "Mandarins", type: "fruit", category: "citrus" },
  
  // Stone fruits
  { name: "Peaches", type: "fruit", category: "stone" },
  { name: "Plums", type: "fruit", category: "stone" },
  { name: "Nectarines", type: "fruit", category: "stone" },
  { name: "Cherries", type: "fruit", category: "stone" },
  { name: "Apricots", type: "fruit", category: "stone" },
  
  // Pome fruits
  { name: "Apples", type: "fruit", category: "pome" },
  { name: "Pears", type: "fruit", category: "pome" },
  
  // Tropical
  { name: "Bananas", type: "fruit", category: "tropical" },
  { name: "Pineapple", type: "fruit", category: "tropical" },
  { name: "Mango", type: "fruit", category: "tropical" },
  { name: "Papaya", type: "fruit", category: "tropical" },
  { name: "Kiwi", type: "fruit", category: "tropical" },
  
  // Melons
  { name: "Watermelon", type: "fruit", category: "melon" },
  { name: "Cantaloupe", type: "fruit", category: "melon" },
  { name: "Honeydew", type: "fruit", category: "melon" },
  
  // Other fruits
  { name: "Grapes", type: "fruit", category: "vine" },
  { name: "Avocado", type: "fruit", category: "other" },
  { name: "Pomegranate", type: "fruit", category: "other" },
];

async function seed() {
  console.log("🌱 Seeding database...");

  const allItems = [...vegetables, ...fruits];

  const itemTxs = allItems.map((item) =>
    adminDb.tx.items[id()].update({
      name: item.name,
      type: item.type,
      category: item.category,
      enabled: true,
      createdAt: Date.now(),
    })
  );

  // Add default settings
  const settingsTx = adminDb.tx.settings[id()].update({
    itemsPerCategory: 2,
    cooldownDays: 7,
    updatedAt: Date.now(),
  });

  await adminDb.transact([...itemTxs, settingsTx]);

  console.log(`✅ Seeded ${allItems.length} items and default settings!`);
  console.log(`   - ${vegetables.length} vegetables`);
  console.log(`   - ${fruits.length} fruits`);
  console.log("🎉 Database is ready!");
}

seed().catch(console.error);
