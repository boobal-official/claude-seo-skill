// JSON-LD validation against Google's documented required properties for rich results.
// "required" = without it the item is ineligible for that rich result.
// Rich result availability changes; always confirm current eligibility at
// https://developers.google.com/search/docs/appearance/structured-data/search-gallery
import { extractJsonLd, walkNodes } from './lib.mjs';

const ORG_TYPES = ['Organization', 'Corporation', 'NGO', 'EducationalOrganization', 'CollegeOrUniversity', 'School', 'HighSchool', 'ElementarySchool', 'MiddleSchool', 'Preschool', 'MedicalOrganization', 'OnlineBusiness', 'OnlineStore', 'GovernmentOrganization'];
const LOCAL_TYPES = ['LocalBusiness', 'MedicalBusiness', 'MedicalClinic', 'Dentist', 'Physician', 'Hospital', 'Pharmacy', 'Optician', 'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Bakery', 'Store', 'ClothingStore', 'ElectronicsStore', 'GroceryStore', 'AutoRepair', 'AutoDealer', 'LegalService', 'Attorney', 'RealEstateAgent', 'HomeAndConstructionBusiness', 'Plumber', 'Electrician', 'HVACBusiness', 'RoofingContractor', 'FinancialService', 'AccountingService', 'InsuranceAgency', 'LodgingBusiness', 'Hotel', 'BeautySalon', 'HairSalon', 'DaySpa', 'HealthClub', 'ChildCare', 'ProfessionalService', 'TravelAgency', 'SportsActivityLocation', 'Locksmith', 'GeneralContractor', 'MovingCompany', 'HousePainter', 'BarOrPub', 'ExerciseGym', 'VeterinaryCare', 'AnimalShelter', 'Library', 'EmploymentAgency', 'RealEstateAgent', 'SelfStorage', 'ShoppingCenter', 'AutomotiveBusiness', 'AutoBodyShop', 'MotorcycleRepair', 'GasStation', 'TouristInformationCenter', 'EntertainmentBusiness', 'NightClub', 'MovieTheater', 'BowlingAlley', 'GolfCourse', 'StadiumOrArena', 'SkiResort', 'DryCleaningOrLaundry', 'EmergencyService', 'FireStation', 'PoliceStation', 'Notary', 'Florist', 'FurnitureStore', 'HardwareStore', 'JewelryStore', 'BookStore', 'PetStore', 'ShoeStore', 'SportingGoodsStore', 'ToyStore', 'MobilePhoneStore', 'DepartmentStore', 'ConvenienceStore', 'LiquorStore', 'OfficeEquipmentStore', 'OutletStore', 'PawnShop', 'TireShop', 'WholesaleStore', 'HobbyShop', 'MusicStore', 'GardenStore', 'HomeGoodsStore', 'ComputerStore', 'BikeStore', 'Campground', 'Hostel', 'Motel', 'Resort', 'BedAndBreakfast', 'NailSalon', 'TattooParlor', 'RecyclingCenter', 'GovernmentOffice', 'PostOffice', 'RadioStation', 'TelevisionStation', 'InternetCafe', 'IceCreamShop', 'FastFoodRestaurant', 'Brewery', 'Winery', 'Distillery', 'MedicalClinic', 'DiagnosticLab', 'PhysicalTherapy'];
const ARTICLE_TYPES = ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report', 'ScholarlyArticle'];
const APP_TYPES = ['SoftwareApplication', 'MobileApplication', 'WebApplication', 'VideoGame'];

// any-of groups: [['a','b'], ['c']] means (a OR b) AND c
const RULES = [
  { types: ['Product'], required: [['name'], ['offers', 'review', 'aggregateRating']], recommended: ['image', 'description', 'brand', 'sku'] },
  { types: ['Offer'], required: [['price', 'priceSpecification'], ['priceCurrency', 'priceSpecification']], recommended: ['availability', 'url'], onlyUnder: ['Product', ...APP_TYPES] },
  { types: ['AggregateOffer'], required: [['lowPrice'], ['priceCurrency']], recommended: ['highPrice', 'offerCount'] },
  { types: ['AggregateRating'], required: [['ratingValue'], ['ratingCount', 'reviewCount']] },
  { types: ['Review'], required: [['author'], ['reviewRating']], recommended: ['itemReviewed', 'datePublished'] },
  { types: ['BreadcrumbList'], required: [['itemListElement']] },
  { types: ['FAQPage'], required: [['mainEntity']], note: 'FAQ rich results are no longer shown for any site (since 7 May 2026). The markup is valid and harmless but earns no rich result; do not add it for that purpose.' },
  { types: ['HowTo'], required: [], note: 'HowTo rich results are no longer shown in Google Search (deprecated 2023). Keep the content; the markup earns nothing.' },
  { types: ARTICLE_TYPES, required: [], recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author'] },
  { types: ['Event'], required: [['name'], ['startDate'], ['location']], recommended: ['endDate', 'eventStatus', 'image', 'offers', 'organizer'] },
  { types: ['JobPosting'], required: [['title'], ['description'], ['datePosted'], ['hiringOrganization'], ['jobLocation', 'applicantLocationRequirements']], recommended: ['validThrough', 'employmentType', 'baseSalary'] },
  { types: ['VideoObject'], required: [['name'], ['thumbnailUrl'], ['uploadDate']], recommended: ['description', 'duration', 'contentUrl', 'embedUrl'] },
  { types: ['Recipe'], required: [['name'], ['image']], recommended: ['author', 'datePublished', 'recipeIngredient', 'recipeInstructions'] },
  { types: APP_TYPES, required: [['name'], ['offers'], ['aggregateRating', 'review']], recommended: ['operatingSystem', 'applicationCategory'] },
  { types: ['Course'], required: [['name'], ['description']], recommended: ['provider'], note: 'The Course Info rich result was retired (2025); only the Course list carousel may remain. Confirm in the Search Gallery before promising any rich result; the markup still helps entity understanding.' },
  { types: ['Dataset'], required: [['name'], ['description']] },
  { types: LOCAL_TYPES, required: [['name'], ['address']], recommended: ['telephone', 'url', 'geo', 'openingHoursSpecification', 'image', 'priceRange'] },
  { types: ORG_TYPES, required: [], recommended: ['name', 'url', 'logo', 'sameAs'] },
  { types: ['WebSite'], required: [], recommended: ['name', 'url'] },
  { types: ['ProfilePage'], required: [['mainEntity']] },
  { types: ['QAPage'], required: [['mainEntity']] },
];

const has = (node, key) => {
  const v = node[key];
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
};

export function validateJsonLd(html) {
  const issues = [];
  const types = new Set();
  const blocks = extractJsonLd(html);
  blocks.forEach((b, bi) => {
    if (!b.ok) {
      issues.push({ sev: 'HIGH', code: 'jsonld-parse-error', msg: `JSON-LD block #${bi + 1} is invalid JSON (${b.error}). Google ignores the whole block. Starts: ${b.snippet}`, fix: 'Generate JSON-LD with JSON.stringify instead of hand-written strings.' });
      return;
    }
    const roots = Array.isArray(b.data) ? b.data : [b.data];
    for (const r of roots) {
      const ctx = JSON.stringify(r?.['@context'] ?? '');
      if (!/schema\.org/i.test(ctx)) issues.push({ sev: 'MEDIUM', code: 'jsonld-no-context', msg: `JSON-LD block #${bi + 1} has no schema.org @context; parsers cannot interpret its types.` });
    }
    for (const { node, types: nodeTypes, parentTypes } of walkNodes(b.data)) {
      nodeTypes.forEach((t) => types.add(t));
      for (const rule of RULES) {
        if (!nodeTypes.some((t) => rule.types.includes(t))) continue;
        if (rule.onlyUnder && !parentTypes.some((t) => rule.onlyUnder.includes(t))) continue;
        const label = nodeTypes.join('/');
        for (const group of rule.required) {
          if (!group.some((k) => has(node, k))) {
            issues.push({ sev: 'MEDIUM', code: 'schema-missing-required', msg: `${label}: missing required ${group.join(' or ')} (not eligible for its rich result).` });
          }
        }
        const missingRec = (rule.recommended || []).filter((k) => !has(node, k));
        if (missingRec.length) issues.push({ sev: 'INFO', code: 'schema-missing-recommended', msg: `${label}: recommended properties missing: ${missingRec.join(', ')}.` });
        if (rule.note) issues.push({ sev: 'INFO', code: 'schema-note', msg: `${label}: ${rule.note}` });
      }
      // Type-specific deeper checks
      if (nodeTypes.includes('BreadcrumbList')) {
        const items = [].concat(node.itemListElement || []);
        items.forEach((it, i) => {
          if (!has(it, 'position') || !(has(it, 'name') || (it.item && typeof it.item === 'object' && has(it.item, 'name'))))
            issues.push({ sev: 'MEDIUM', code: 'breadcrumb-item', msg: `BreadcrumbList item ${i + 1}: needs position and name.` });
          if (i < items.length - 1 && !has(it, 'item')) issues.push({ sev: 'MEDIUM', code: 'breadcrumb-item-url', msg: `BreadcrumbList item ${i + 1}: needs "item" (URL); only the last crumb may omit it.` });
        });
      }
      if (nodeTypes.includes('FAQPage')) {
        const qs = [].concat(node.mainEntity || []);
        qs.forEach((q, i) => {
          if (!has(q, 'name') || !q.acceptedAnswer || !has(q.acceptedAnswer, 'text'))
            issues.push({ sev: 'MEDIUM', code: 'faq-item', msg: `FAQPage question ${i + 1}: needs name and acceptedAnswer.text.` });
        });
      }
      if (nodeTypes.some((t) => ARTICLE_TYPES.includes(t))) {
        const authors = [].concat(node.author || []);
        if (authors.some((a) => typeof a === 'string'))
          issues.push({ sev: 'LOW', code: 'article-author-string', msg: `${nodeTypes[0]}: author is a plain string; use a Person/Organization object with name and url (a profile page) so the author entity is clear.` });
      }
      if (nodeTypes.includes('AggregateRating') || nodeTypes.includes('Review')) {
        if (parentTypes.some((t) => [...ORG_TYPES, ...LOCAL_TYPES].includes(t)))
          issues.push({ sev: 'MEDIUM', code: 'self-serving-review', msg: `${nodeTypes[0]} attached to ${parentTypes[0]}: Google does not show review stars for reviews a business publishes about itself (self-serving reviews) on LocalBusiness/Organization.` });
      }
    }
  });
  if (/\bitemscope\b/i.test(html)) issues.push({ sev: 'INFO', code: 'microdata-present', msg: 'Microdata (itemscope) found; this script validates JSON-LD only. Check it with the Rich Results Test.' });
  return { blocks: blocks.length, types: [...types], issues };
}
