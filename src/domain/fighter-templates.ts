import { parseEncumbranceToSixths, type StartingTemplate } from './template-catalog'

export const fighterTemplates: readonly StartingTemplate[] = [
  {
    rollMin: 3,
    rollMax: 4,
    template: 'Thug',
    proficiencies: ['Combat Ferocity', 'Intimidation'],
    startingEquipmentText:
      "Short bow, quiver with 20 arrows, morning star, scarred leather armor, wool tunic and pants, embossed belt, low boots, backpack, waterskin, 1 week's daily iron rations",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 4 4/6 st'),
  },
  {
    rollMin: 5,
    rollMax: 6,
    template: 'Ravager',
    proficiencies: ['Berserkergang', 'Endurance'],
    startingEquipmentText:
      "Long bearded axe (great axe), francisca (hand axe), chain mail armor, thick wool cloak, wool tunic and pants, leather belt, low boots, belt pouch, small sack, waterskin, 1 week's daily iron rations",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 4/6 st'),
  },
  {
    rollMin: 7,
    rollMax: 8,
    template: 'Corsair',
    proficiencies: ['Swashbuckling', 'Seafaring'],
    startingEquipmentText:
      "Short bow, quiver with 20 arrows, scimitar (short sword), 2 well-balanced daggers with boot-sheaths, leather armor, colorful tunic and pants, silk girdle, leather duelist's gloves, high boots, small sack, 50' rope, grappling hook, waterskin, 1 week's daily iron rations, 4gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 5 3/6 st'),
  },
  {
    rollMin: 9,
    rollMax: 10,
    template: 'Auxiliary',
    proficiencies: ['Skirmishing', 'Labor (construction)'],
    startingEquipmentText:
      "3 javelins, short sword, wooden shield, chain mail armor, armiger's tunic and pants, embossed belt, high boots, backpack, laborer's tools, mess kit, flask of military oil, tinderbox, 1 week's daily iron rations, 10gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 8 3/6 st'),
  },
  {
    rollMin: 11,
    rollMax: 12,
    template: 'Legionary',
    proficiencies: ['Fighting Style Spec. (weapon & shield)', 'Siege Engineering'],
    startingEquipmentText:
      "Military-issue spear and short sword, steel shield re-painted many times, slightly battered banded plate armor, armiger's tunic and pants, embossed belt, high boots, backpack, laborer's tools, mess kit, flask of military oil, tinderbox, waterskin, 1 week's daily iron rations, 20gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 10 st'),
  },
  {
    rollMin: 13,
    rollMax: 14,
    template: 'Gladiator',
    proficiencies: ['Weapon Focus (swords and daggers)', 'Seduction'],
    startingEquipmentText:
      "2 swords, heavy arena armor, plumed heavy helmet with visor and crest, armiger's tunic and pants, sandals, small sack, amphora of oil (for polishing body), 1 week's daily iron rations, 38gp in arena winnings",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 st'),
  },
  {
    rollMin: 15,
    rollMax: 16,
    template: 'Signifer',
    proficiencies: ['Command', 'Manual of Arms 2'],
    startingEquipmentText:
      "Military-issue spear and sword, steel shield bearing Imperial eagle, banded plate armor, banner flag bearing winged sun, armiger's tunic and pants, low boots, short gloves, backpack, mess kit, tinderbox, waterskin, 1 week's daily iron rations, 57gp in back pay",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 9 5/6 st'),
  },
  {
    rollMin: 17,
    rollMax: 18,
    template: 'Cataphract',
    proficiencies: ['Mounted Combat', 'Military Strategy'],
    startingEquipmentText:
      "Composite bow, quiver with 20 arrows, polished sword, steel shield bearing noble house's crest, lamellar armor, armiger's tunic and pants, high boots, medium riding horse, riding saddle and tack, saddlebag, waterskin, 1 week's daily iron rations, 2gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 7 2/6 st with rations on horse'),
  },
]
