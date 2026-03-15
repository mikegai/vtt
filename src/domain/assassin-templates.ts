import { parseEncumbranceToSixths, type StartingTemplate } from './template-catalog'

export const assassinTemplates: readonly StartingTemplate[] = [
  {
    rollMin: 3,
    rollMax: 4,
    template: 'Cutthroat',
    proficiencies: ['Combat Reflexes', 'Gambling'],
    startingEquipmentText:
      "Hand axe, dagger, leather armor, cheap tunic and pants, leather belt, high boots, backpack, 12 iron spikes, small hammer, flask of military oil, tinderbox, 12 torches, waterskin, 1 week's iron rations,",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 5 3/6 st'),
  },
  {
    rollMin: 5,
    rollMax: 6,
    template: 'Bounty Hunter',
    proficiencies: ['Combat Trickery (incapacitate)', 'Tracking'],
    startingEquipmentText:
      "Bola, serrated sword, dagger, net, leather armor, black cloak, traveler's tunic and pants, high boots, backpack, crowbar, 50' rope, manacles, waterskin, 1 week's iron rations, 2gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 1/6 st'),
  },
  {
    rollMin: 7,
    rollMax: 8,
    template: 'Pirate',
    proficiencies: ['Swashbuckling', 'Seafaring'],
    startingEquipmentText:
      "Short bow, quiver with 20 arrows, scimitar, well-balanced dagger with boot-sheath, leather armor, colorful tunic and pants, silk sash, high boots, 50' rope, grappling hook, waterskin, 1 week's iron rations",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 5 st'),
  },
  {
    rollMin: 9,
    rollMax: 10,
    template: 'Bravo',
    proficiencies: ['Fighting Style Spec. (dual weapon)', 'Intimidation'],
    startingEquipmentText:
      "Crossbow, case with 20 bolts, serrated sword, left-hand dagger, black leather armor, duelist's cloak, armiger's tunic and pants, leather belt, leather duelist's gloves, high boots, belt pouch with bone dice made from last foe, backpack, waterskin, 1 week's iron rations, 9gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 4 2/6 st'),
  },
  {
    rollMin: 11,
    rollMax: 12,
    template: 'Assassin-for-Hire',
    proficiencies: ['Precise Shooting', 'Bargaining'],
    startingEquipmentText:
      "Arbalest, case with 20 bolts, pair of well-sharpened short swords, bloodstained leather armor, dark cloak with hood, black tunic and pants, low boots, leather belt, small sack, 2 flasks of military oil, tinderbox, 50' rope, waterskin, 1 week's iron rations, 15gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 2/6 st'),
  },
  {
    rollMin: 13,
    rollMax: 14,
    template: 'Poisoner',
    proficiencies: ['Poisoning', 'Seduction'],
    startingEquipmentText:
      "Slender short sword, dagger, long leather whip, tight leather armor, leather cloak, elegant linen tunic and pants, silk sash, high boots, backpack, manacles, 1 dose of giant centipede poison, 1 lb of dried belladonna, waterskin, 1 week's iron rations, 19gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 4 2/6 st'),
  },
  {
    rollMin: 15,
    rollMax: 16,
    template: 'Infiltrator',
    proficiencies: ['Skulking', 'Disguise'],
    startingEquipmentText:
      "Crossbow, case with 20 bolts, short sword, dagger, unmarked leather armor, simple hooded cloak, plain tunic and pants, leather belt, low boots, backpack, thieves' tools, disguise kit, waterskin, 1 week's iron rations, 33gp for bribes",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 5 2/6 st'),
  },
  {
    rollMin: 17,
    rollMax: 18,
    template: 'Cult Deathbringer',
    proficiencies: ['Arcane Dabbling', 'Theology'],
    startingEquipmentText:
      "Crossbow, case with 20 bolts, wavy-bladed sword and short sword, dagger in wrist sheath, leather armor under grey cassock with hood, long leather gloves, soft-soled shoes, leather belt, 2 belt pouches, holy symbol (eclipsed sun), 2 flasks of holy water, holy book (The Eclipse of Calefa), 6 torches, waterskin, 1 week's iron rations, 4gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 2/6 st'),
  },
]

