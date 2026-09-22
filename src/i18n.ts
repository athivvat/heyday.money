export type Language = "en" | "th";

const en = {
  title: "Heyday.Money — Your money, Your Heyday!",
  description:
    "Take back control of your finances. A clear picture of your cash flow, spending, and subscriptions, with Heyday.Money for macOS and Windows.",
  skip: "Skip to content",
  perspective: "A brighter perspective",
  nightMode: "Night mode",
  language: "Language",
  kicker: "A LITTLE CLARITY. A LOT MORE FREEDOM.",
  headline: "Your money,",
  headlineAccent: "Your Heyday!",
  intro: "A clear picture of your cash flow, spending, and subscriptions.",
  introNext: "Take back control of your finances. Make room for living.",
  islandLabel: "Your own little world of financial freedom",
  islandAlt:
    "A peaceful floating island with a purple-roofed home, green trees, and a little pond",
  cashKicker: "SEE THE BIG PICTURE",
  cashTitle: "Cash flow, made clear",
  spendingKicker: "KNOW WHERE IT GOES",
  spendingTitle: "Mindful spending",
  subscriptionsKicker: "STAY ONE STEP AHEAD",
  subscriptionsTitle: "Subscriptions in sight",
  downloadLabel: "Download Heyday Money",
  freshStart: "A fresh start for your finances.",
  downloadFor: "Download for",
  preparing: "Preparing download…",
  downloadNote: "macOS public alpha · Windows coming soon",
  windowsNotice:
    "Heyday for Windows is coming soon. Your fresh start is on its way.",
  footer: "Don’t let money control you.",
  footerAccent: "Play your game.",
  definition: "Your Prime, Defined.",
  dismiss: "Dismiss notification",
};

export const translations: Record<Language, typeof en> = {
  en,
  th: {
    title: "Heyday.Money — เงินของคุณ ชีวิตในแบบคุณ",
    description:
      "มองเห็นกระแสเงินสด รายจ่าย และค่าสมาชิกได้ชัดเจน จัดการการเงินในแบบของคุณด้วย Heyday.Money สำหรับ macOS และ Windows",
    skip: "ข้ามไปยังเนื้อหา",
    perspective: "มุมมองใหม่ที่สดใสกว่า",
    nightMode: "โหมดกลางคืน",
    language: "ภาษา",
    kicker: "เข้าใจเงินมากขึ้น ใช้ชีวิตได้อิสระกว่า",
    headline: "เงินของคุณ",
    headlineAccent: "ชีวิตในแบบคุณ",
    intro: "เห็นภาพกระแสเงินสด รายจ่าย และค่าสมาชิกได้ชัดเจน",
    introNext: "กลับมาดูแลการเงินของคุณ แล้วมีเวลาให้ชีวิตมากขึ้น",
    islandLabel: "โลกใบเล็กแห่งอิสระทางการเงินของคุณ",
    islandAlt:
      "เกาะลอยฟ้าอันสงบ มีบ้านหลังคาสีม่วง ต้นไม้สีเขียว และบ่อน้ำเล็ก ๆ",
    cashKicker: "มองเห็นภาพรวม",
    cashTitle: "กระแสเงินสดที่เข้าใจง่าย",
    spendingKicker: "รู้ว่าเงินไปไหน",
    spendingTitle: "ใช้จ่ายอย่างใส่ใจ",
    subscriptionsKicker: "วางแผนล่วงหน้า",
    subscriptionsTitle: "ไม่พลาดทุกค่าสมาชิก",
    downloadLabel: "ดาวน์โหลด Heyday Money",
    freshStart: "เริ่มต้นใหม่กับการเงินของคุณ",
    downloadFor: "ดาวน์โหลดสำหรับ",
    preparing: "กำลังเตรียมดาวน์โหลด…",
    downloadNote: "macOS เปิดให้ทดลองเวอร์ชันอัลฟา · Windows เร็ว ๆ นี้",
    windowsNotice:
      "Heyday สำหรับ Windows กำลังจะมา พร้อมให้คุณเริ่มต้นใหม่เร็ว ๆ นี้",
    footer: "Don’t let money control you.",
    footerAccent: "Play your game.",
    definition: "Your Prime, Defined.",
    dismiss: "ปิดการแจ้งเตือน",
  },
};

export function languageHead(language: Language) {
  const t = translations[language];
  return {
    meta: [{ title: t.title }, { name: "description", content: t.description }],
    links: [
      { rel: "alternate", hrefLang: "en", href: "/" },
      { rel: "alternate", hrefLang: "th", href: "/th" },
      { rel: "alternate", hrefLang: "x-default", href: "/" },
    ],
  };
}
