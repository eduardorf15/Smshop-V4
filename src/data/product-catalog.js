const defaultCategoryName = "Tecnologia";

const rawProductCatalog = [
  {
    id: "tech-001",
    sku: "001",
    name: "Smartwatch Aurafit Trek 2",
    meliId: "MLB66266661",
    price: 351.96,
    productType: "Smartwatch",
    description: "Relogio outdoor com proposta robusta para trilhas, treinos e rotina ativa, com leitura clara e visual esportivo premium.",
    tags: ["smartwatch", "outdoor", "treino"]
  },
  {
    sku: "002",
    name: "Relógio Smartwatch Amazfit Active 2",
    price: 749,
    productType: "Smartwatch",
    description: "Smartwatch elegante para saude e treino, com ecossistema Zepp, integração com apps fitness e acabamento de uso diário.",
    tags: ["smartwatch", "saude", "fitness"]
  },
  {
    sku: "003",
    name: "Kit Youtuber",
    price: 142.65,
    productType: "Creator",
    description: "Kit pratico para gravar videos, lives e conteudos curtos com luz, suporte e estrutura pronta para criar com mais qualidade.",
    tags: ["creator", "video", "setup"]
  },
  {
    sku: "004",
    name: "Ring Light B&G",
    price: 29.99,
    productType: "Creator",
    description: "Luz circular compacta para melhorar rosto, produto e enquadramento em chamadas, videos e fotos de rotina.",
    tags: ["ring light", "foto", "video"]
  },
  {
    sku: "005",
    name: "Iluminador Ring Light Led Profissional",
    price: 289.99,
    productType: "Creator",
    description: "Iluminação LED ampla para creator, maquiagem e gravações, com presença visual limpa e controle melhor da cena.",
    tags: ["iluminacao", "creator", "studio"]
  },
  {
    sku: "006",
    name: "Carregador Power Bank Magnético",
    price: 40.77,
    productType: "Energia",
    description: "Bateria magnetica para levar energia extra no bolso, ideal para uso rapido com smartphones compativeis.",
    tags: ["power bank", "magnetico", "mobile"]
  },
  {
    sku: "007",
    name: "Carregador Magsafe Por Indução Sem Fio",
    price: 47.58,
    productType: "Energia",
    description: "Carregamento por indução com alinhamento magnetico, pensado para uma mesa mais limpa e recargas sem cabo solto.",
    tags: ["magsafe", "inducao", "wireless"]
  },
  {
    sku: "008",
    name: "Carregador Portátil Indução",
    price: 499,
    productType: "Energia",
    description: "Base portatil de indução para carregar com praticidade e manter o setup organizado em casa, trabalho ou viagem.",
    tags: ["inducao", "portatil", "setup"]
  },
  {
    sku: "009",
    name: "Basike Carregador Sem Fio",
    price: 160,
    productType: "Energia",
    description: "Carregador sem fio Basike com proposta minimalista para reduzir cabos e manter o smartphone sempre à vista.",
    tags: ["basike", "wireless", "desk"]
  },
  {
    sku: "010",
    name: "Carregador Turbo sem fio Magnético",
    price: 34.9,
    productType: "Energia",
    description: "Carregador magnetico compacto para recargas rapidas e alinhadas, com visual discreto para o dia a dia.",
    tags: ["turbo", "magnetico", "wireless"]
  },
  {
    sku: "011",
    name: "Carregador Turbo 125w",
    price: 76.64,
    productType: "Energia",
    description: "Carregador de alta potencia para quem precisa reduzir tempo de tomada e manter varios dispositivos prontos.",
    tags: ["turbo", "125w", "usb"]
  },
  {
    sku: "012",
    name: "Power Bank Turbo Portátil 50.000mAh",
    price: 133.86,
    productType: "Energia",
    description: "Power bank de grande capacidade para viagens, trabalho externo e dias longos longe da tomada.",
    tags: ["power bank", "50000mah", "viagem"]
  },
  {
    sku: "013",
    name: "Carregador Turbo 120W",
    price: 32.99,
    productType: "Energia",
    description: "Fonte turbo de alta potencia para recarga veloz de dispositivos compativeis, com pegada simples e funcional.",
    tags: ["turbo", "120w", "carregador"]
  },
  {
    sku: "014",
    name: "Carregador Portátil 20000 Turbo 22.5w",
    price: 69.99,
    productType: "Energia",
    description: "Bateria portatil de 20.000mAh com saida turbo 22.5W para manter celular e acessorios em movimento.",
    tags: ["power bank", "20000mah", "22.5w"]
  },
  {
    sku: "015",
    name: "Carregador Basike GaN de Parede 100W",
    price: 250.25,
    productType: "Energia",
    description: "Carregador GaN 100W compacto para concentrar potencia em menos volume, ideal para celular, tablet e notebook USB-C.",
    tags: ["gan", "100w", "usb-c"]
  },
  {
    sku: "016",
    name: "Carregador Turbo 40w",
    price: 39.9,
    productType: "Energia",
    description: "Carregador compacto de 40W para uso diario, com proposta direta: mais velocidade sem ocupar espaço.",
    tags: ["turbo", "40w", "compacto"]
  },
  {
    sku: "017",
    name: "Smartwatch Amoled",
    price: 199.99,
    productType: "Smartwatch",
    description: "Smartwatch com tela AMOLED para cores mais fortes, leitura confortável e presença visual sofisticada no pulso.",
    tags: ["smartwatch", "amoled", "saude"]
  },
  {
    sku: "018",
    name: "Smartwatch PEJE ZW10",
    price: 182,
    productType: "Smartwatch",
    description: "Relogio inteligente para notificações, monitoramento e rotina fitness com design urbano e interface simples.",
    tags: ["smartwatch", "fitness", "notificacoes"]
  },
  {
    sku: "019",
    name: "Fone De Ouvido Qcy T13x",
    price: 189.9,
    productType: "Audio",
    description: "TWS com bateria longa, chamadas com redução de ruido ENC e encaixe leve para ouvir, trabalhar e treinar.",
    tags: ["qcy", "tws", "bluetooth"]
  },
  {
    sku: "020",
    name: "Fone de Ouvido Bluetooth JBL Tune 720BT",
    price: 292.59,
    productType: "Audio",
    description: "Headphone sem fio com assinatura JBL Pure Bass e bateria de longa duração para musica, estudo e viagens.",
    tags: ["jbl", "headphone", "pure bass"]
  },
  {
    sku: "021",
    name: "Fone Bluetooth Wave Buds 2 Tws",
    price: 255.09,
    productType: "Audio",
    description: "Earbuds TWS com perfil moderno, drivers dinamicos e proposta de som forte para rua, treino e rotina.",
    tags: ["tws", "buds", "bluetooth"]
  },
  {
    sku: "022",
    name: "Fone De Ouvido Sem Fio TWS Philips",
    price: 125.61,
    productType: "Audio",
    description: "Fone TWS Philips para quem busca simplicidade, estojo compacto e audio sem fio para o cotidiano.",
    tags: ["philips", "tws", "sem fio"]
  },
  {
    sku: "023",
    name: "Fone De Ouvido Bluetooth Sem Inova",
    price: 70.2,
    productType: "Audio",
    description: "Fone Bluetooth acessivel para chamadas, videos e musicas, com formato portatil e uso facil.",
    tags: ["bluetooth", "mobile", "chamadas"]
  },
  {
    sku: "024",
    name: "Fone De Ouvido Sem Fio Philips",
    price: 115,
    productType: "Audio",
    description: "Modelo sem fio Philips para escuta diaria, com visual discreto e praticidade para levar no bolso.",
    tags: ["philips", "wireless", "audio"]
  },
  {
    sku: "025",
    name: "Fone De Ouvido Sem Fio Xiaomi Redmi Buds 6 Play",
    price: 98.76,
    productType: "Audio",
    description: "Earbuds Redmi leves e compactos para uso diario, com pareamento simples e estojo minimalista.",
    tags: ["xiaomi", "redmi", "buds"]
  },
  {
    sku: "026",
    name: "Hivi Fone De Ouvido Bluetooth",
    price: 24.98,
    productType: "Audio",
    description: "Fone Bluetooth essencial para quem quer mobilidade, audio sem fio e preço direto.",
    tags: ["bluetooth", "essencial", "fone"]
  },
  {
    sku: "027",
    name: "Fone Qcy Ht05 Melobuds",
    price: 269.9,
    productType: "Audio",
    description: "MeloBuds com ANC hibrido, chamadas com multiplos microfones e bateria de longa duração com o estojo.",
    tags: ["qcy", "anc", "melobuds"]
  },
  {
    sku: "028",
    name: "Fone Qcy N30 Anc",
    price: 191,
    productType: "Audio",
    description: "Fone QCY com cancelamento ativo de ruido para focar melhor em musica, chamadas e deslocamentos.",
    tags: ["qcy", "anc", "tws"]
  },
  {
    sku: "029",
    name: "Fone De Ouvido Bluetooth T29 Awei",
    price: 109.9,
    productType: "Audio",
    description: "TWS Awei para rotina urbana, com estojo compacto, conexão Bluetooth e pegada leve.",
    tags: ["awei", "tws", "bluetooth"]
  },
  {
    sku: "030",
    name: "Fone De Ouvido Headphone Dapon H02d",
    price: 78.9,
    productType: "Audio",
    description: "Headphone Bluetooth para estudar, trabalhar e ouvir playlists com conforto de arco e boa autonomia.",
    tags: ["headphone", "bluetooth", "conforto"]
  },
  {
    sku: "031",
    name: "Fone Bluetooth Gancho",
    price: 49.98,
    productType: "Audio",
    description: "Fone com gancho para mais firmeza em movimento, ideal para caminhada, treino leve e chamadas.",
    tags: ["gancho", "esporte", "bluetooth"]
  },
  {
    sku: "032",
    name: "Fone de Ouvido Bluetooth P30i da Anker",
    price: 208.22,
    productType: "Audio",
    description: "Soundcore P30i com Bluetooth 5.4, cancelamento de ruido e case pensado para uso prático fora de casa.",
    tags: ["anker", "soundcore", "anc"]
  },
  {
    sku: "033",
    name: "Fone De Ouvido Sem Fio Bluetooth F9-5",
    price: 24.99,
    productType: "Audio",
    description: "Fone sem fio compacto para chamadas e musicas do dia a dia, com estojo de recarga e uso simples.",
    tags: ["tws", "bluetooth", "compacto"]
  },
  {
    sku: "034",
    name: "Fones de ouvido abertos da Basike com clipe",
    price: 189.81,
    productType: "Audio",
    description: "Fone aberto com clipe para ouvir sem isolar totalmente o ambiente, combinando conforto e mobilidade.",
    tags: ["basike", "open ear", "clipe"]
  },
  {
    sku: "035",
    name: "Eletro Mex, Fone De Ouvido, Sem Fio",
    price: 61.38,
    productType: "Audio",
    description: "Fone sem fio para consumo diario de video, musica e chamadas, com proposta acessivel e portatil.",
    tags: ["sem fio", "mobile", "audio"]
  },
  {
    sku: "036",
    name: "Fone Ouvido Bluetooth 5.4",
    price: 49.72,
    productType: "Audio",
    description: "Fone Bluetooth 5.4 com conexão atualizada para pareamento rapido, uso estavel e rotina sem cabos.",
    tags: ["bluetooth 5.4", "tws", "conexao"]
  },
  {
    sku: "037",
    name: "Fone De Ouvido Gamer Bluetooth Led Rgb",
    price: 47.43,
    productType: "Audio",
    description: "Fone gamer Bluetooth com visual RGB para jogos casuais, videos e chamadas com presença mais expressiva.",
    tags: ["gamer", "rgb", "bluetooth"]
  }
];

export const productCatalog = rawProductCatalog.map((product) => ({
  ...product,
  meliId: product.meliId || null,
  meliUrl: product.meliUrl || null,
  category: product.category || defaultCategoryName,
  categorySlug: product.categorySlug || slugify(product.category || defaultCategoryName),
  categoryTags: [...new Set([...(product.categoryTags || []), product.categorySlug || slugify(product.category || defaultCategoryName)])]
}));

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
