const COLOR_OPTIONS = [
  ["Black", "#000000"], ["White", "#FFFFFF"], ["Blue", "#2563EB"],
  ["Navy Blue", "#1E3A8A"], ["Sky Blue", "#38BDF8"], ["Red", "#DC2626"],
  ["Burgundy", "#800020"], ["Green", "#16A34A"], ["Dark Green", "#166534"],
  ["Olive Green", "#6B8E23"], ["Yellow", "#FACC15"], ["Gold", "#D4AF37"],
  ["Orange", "#F97316"], ["Purple", "#9333EA"], ["Lavender", "#C4B5FD"],
  ["Pink", "#EC4899"], ["Rose Gold", "#B76E79"], ["Brown", "#92400E"],
  ["Beige", "#D6C6A5"], ["Cream", "#FFFDD0"], ["Grey", "#6B7280"],
  ["Silver", "#C0C0C0"], ["Charcoal", "#36454F"], ["Teal", "#0D9488"],
  ["Turquoise", "#40E0D0"], ["Maroon", "#800000"], ["Khaki", "#C3B091"],
];

const COMMON_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "Free Size"];

const variationPresets = [
  { name: "Color", type: "color", options: COLOR_OPTIONS.map(([label, hex]) => ({ label, swatchColor: hex })) },
  { name: "Size", options: COMMON_SIZES.map((label) => ({ label })) },
  { name: "Clothing Size", options: COMMON_SIZES.map((label) => ({ label })) },
  { name: "Shoe Size", options: ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48"].map((label) => ({ label })) },
  { name: "Storage", options: ["16GB", "32GB", "64GB", "128GB", "256GB", "512GB", "1TB", "2TB", "4TB"].map((label) => ({ label })) },
  { name: "Memory", options: ["2GB", "4GB", "6GB", "8GB", "12GB", "16GB", "24GB", "32GB", "48GB", "64GB", "96GB", "128GB"].map((label) => ({ label })) },
  { name: "RAM", options: ["2GB", "4GB", "6GB", "8GB", "12GB", "16GB", "24GB", "32GB", "48GB", "64GB", "96GB", "128GB"].map((label) => ({ label })) },
  { name: "Capacity", options: ["250ml", "330ml", "500ml", "750ml", "1L", "1.5L", "2L", "5L", "10L", "20L"].map((label) => ({ label })) },
  { name: "Material", options: ["Cotton", "Polyester", "Leather", "Faux Leather", "Denim", "Silk", "Linen", "Wool", "Nylon", "Plastic", "Metal", "Stainless Steel", "Aluminium", "Glass", "Wood", "Ceramic", "Rubber", "Silicone", "Canvas", "Mesh"].map((label) => ({ label })) },
  { name: "Connection Type", options: ["USB", "USB-C", "Micro USB", "Lightning", "Bluetooth", "Wi-Fi", "Ethernet", "3.5mm", "HDMI", "DisplayPort", "Wireless", "Wired"].map((label) => ({ label })) },
  { name: "Voltage", options: ["5V", "9V", "12V", "24V", "110V", "120V", "220V", "230V", "240V"].map((label) => ({ label })) },
  { name: "Wattage", options: ["5W", "10W", "15W", "20W", "25W", "30W", "45W", "60W", "65W", "100W", "120W", "150W", "200W", "500W", "1000W", "1500W", "2000W"].map((label) => ({ label })) },
  { name: "Pack Size", options: ["Single", "Pack of 2", "Pack of 3", "Pack of 4", "Pack of 5", "Pack of 6", "Pack of 10", "Pack of 12", "Pack of 20", "Pack of 24", "Pack of 50", "Pack of 100"].map((label) => ({ label })) },
  { name: "Quantity", options: ["1", "2", "3", "4", "5", "6", "10", "12", "20", "24", "50", "100"].map((label) => ({ label })) },
  { name: "Screen Size", options: ["5.5 inch", "6.1 inch", "6.3 inch", "6.5 inch", "6.7 inch", "10 inch", "11 inch", "12.9 inch", "13 inch", "13.3 inch", "14 inch", "15 inch", "15.6 inch", "16 inch", "17 inch", "24 inch", "27 inch", "32 inch", "43 inch", "50 inch", "55 inch", "65 inch", "75 inch"].map((label) => ({ label })) },
  { name: "Style", options: ["Classic", "Modern", "Casual", "Formal", "Sport", "Slim", "Regular", "Oversized", "Minimal", "Premium"].map((label) => ({ label })) },
  { name: "Finish", options: ["Matte", "Glossy", "Satin", "Metallic", "Brushed", "Polished", "Textured"].map((label) => ({ label })) },
  { name: "Pattern", options: ["Plain", "Striped", "Checked", "Floral", "Graphic", "Geometric", "Camouflage"].map((label) => ({ label })) },
  { name: "Model", options: [] },
  { name: "Flavor", options: [] },
  { name: "Scent", options: [] },
  { name: "Edition", options: [] },
  { name: "Generation", options: [] },
  { name: "Type", options: [] },
  { name: "Length", options: [] },
  { name: "Width", options: [] },
  { name: "Height", options: [] },
  { name: "Weight", options: [] },
];

const variationNames = [
  ...variationPresets.map((preset) => preset.name),
].filter((name, index, names) => names.indexOf(name) === index);

export function getVariationPreset(name) {
  const normalizedName = String(name ?? "").trim().toLowerCase();
  return variationPresets.find((preset) => preset.name.toLowerCase() === normalizedName) ?? null;
}

export function getVariationOptionPreset(groupName, label) {
  const preset = getVariationPreset(groupName);
  const normalizedLabel = String(label ?? "").trim().toLowerCase();
  return preset?.options.find((option) => option.label.toLowerCase() === normalizedLabel) ?? null;
}

export { variationNames, variationPresets };
