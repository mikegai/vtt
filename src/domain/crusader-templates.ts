import { parseEncumbranceToSixths, type StartingTemplate } from './template-catalog'

export const crusaderTemplates: readonly StartingTemplate[] = [
  {
    rollMin: 3,
    rollMax: 4,
    template: 'Hermit',
    proficiencies: ['Laying on Hands', 'Naturalism'],
    startingEquipmentText:
      "Hand-carved wood holy symbol (winged sun of Ammonar), staff, hide armor, itchy wool tunic and pants, sandals, small sack, waterskin, 2 weeks' iron rations",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 4 2/6 st'),
  },
  {
    rollMin: 5,
    rollMax: 6,
    template: 'Prophet',
    proficiencies: ['Prophecy', 'Performance (storytelling)'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), sling, 30 sling stones, staff, leather armor, grey wool tunic and pants, embossed belt, low boots, backpack, 1 week's iron rations, 6gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 4 5/6 st'),
  },
  {
    rollMin: 7,
    rollMax: 8,
    template: 'Mendicant',
    proficiencies: ['Beast Friendship', 'Animal Husbandry'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), wooden walking staff, leather-backed scale armor, green traveler's cloak, green cassock, sandals, small sack, waterskin, 2 weeks' iron rations, trained hunting dog, 5gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 4/6 st'),
  },
  {
    rollMin: 9,
    rollMax: 10,
    template: 'Proselytizer',
    proficiencies: ['Divine Health', 'Diplomacy'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), mace, wooden shield, ring mail armor, purple priest's cassock, embossed belt, high boots, small sack, holy book (The Laws of the Light), waterskin, 1 week's iron rations, 20sp for alms",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 1/6 st'),
  },
  {
    rollMin: 11,
    rollMax: 12,
    template: 'Priest',
    proficiencies: ['Divine Blessing', 'Theology 2'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), mace, wooden shield, banded plate armor, purple priest's cassock, embossed belt, high boots, small sack, holy book (The Laws of the Light), waterskin, 1 week's iron rations, 25sp for alms",
    declaredEncumbranceSixths: parseEncumbranceToSixths('8 1/6 st'),
  },
  {
    rollMin: 13,
    rollMax: 14,
    template: 'Undead Slayer',
    proficiencies: ['Righteous Rebuke', 'Healing'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), warhammer, steel shield, chain mail armor, blue priest's cassock, leather belt, low boots, backpack, 1 flask of holy water, 1 lb garlic, 1 lb wolfsbane, mirror, 4 stakes and mallet, waterskin, 1 week's iron rations, 8gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 7 3/6 st'),
  },
  {
    rollMin: 15,
    rollMax: 16,
    template: 'Exorcist',
    proficiencies: ['Sensing Evil', 'Intimidation'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), warhammer, steel shield, banded plate armor, blue priest's cassock, leather belt, low boots, backpack, flask of holy water, 6 torches, tinderbox, 50' rope, manacles, waterskin, 1 week's iron rations, 33gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 10 1/2 st'),
  },
  {
    rollMin: 17,
    rollMax: 18,
    template: 'Templar',
    proficiencies: ['Martial Training (swords/daggers)', 'Riding'],
    startingEquipmentText:
      "Holy symbol (winged sun of Ammonar), polished sword and dagger, steel shield bearing symbol of the winged sun, banded plate armor, purple armiger's tunic and pants, embossed belt, riding boots, riding gloves, medium riding horse, riding saddle and tack, leather saddlebag, 1 week's iron rations, 15gp",
    declaredEncumbranceSixths: parseEncumbranceToSixths('enc. 6 3/6 st while rations on horse'),
  },
]

