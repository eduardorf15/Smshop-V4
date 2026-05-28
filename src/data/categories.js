export const defaultCategoryName = "Tecnologia";

export const officialCategories = [
  {
    name: "Tecnologia",
    slug: "tecnologia",
    image: "/fotosCategoria/tecnologia.png",
    tags: ["tecnologia", "gadgets", "smartwatch", "audio", "energia", "creator"]
  },
  {
    name: "Beleza e estética",
    slug: "beleza-estetica",
    image: "/fotosCategoria/beleza.png",
    tags: ["beleza", "estetica", "autocuidado"]
  },
  {
    name: "Fitness e saúde",
    slug: "fitness",
    image: "/fotosCategoria/fitness.png",
    tags: ["fitness", "saude", "bem-estar"]
  },
  {
    name: "Cuidados com Idosos",
    slug: "cuidados-com-idosos",
    image: "/fotosCategoria/cuidados-com-idosos.png",
    tags: ["idosos", "cuidador", "mobilidade", "saude", "seguranca", "monitoramento", "conforto"]
  },
  {
    name: "Moda",
    slug: "moda",
    image: "/fotosCategoria/moda.png",
    tags: ["moda", "vestuario", "acessorios"]
  },
  {
    name: "Casa",
    slug: "casa",
    image: "/fotosCategoria/casa.png",
    tags: ["casa", "conforto", "seguranca-domestica", "rotina"]
  },
  {
    name: "Pets",
    slug: "pets",
    image: "/fotosCategoria/pets.png",
    tags: ["pets", "animais", "cuidado"]
  },
  {
    name: "Infantil",
    slug: "infantil",
    image: "/fotosCategoria/infantil.png",
    tags: ["infantil", "criancas", "familia"]
  }
];

export function getOfficialCategoryBySlug(slug) {
  return officialCategories.find((category) => category.slug === slug) || null;
}

export function getOfficialCategoryByName(name) {
  const slug = slugifyCategory(name);
  return getOfficialCategoryBySlug(slug);
}

export function normalizeCategoryName(name) {
  const trimmed = String(name || "").trim();
  return getOfficialCategoryByName(trimmed)?.name || trimmed || defaultCategoryName;
}

export function slugifyCategory(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
