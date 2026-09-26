import type { Recipe } from '../recipe';
import { qiShrine } from './qiShrine';
import { commandHall } from './commandHall';
import { barracks } from './barracks';
import { refinery } from './refinery';
import { arrowTower, wall } from './tower';
import { halberdier, archer, daoist } from './infantry';
import { woodenOx } from './woodenOx';
import { caravan } from './caravan';
import { workshop } from './workshop';
import { pine, bamboo, peachTree, rock, scholarRock, jadeSmall, jadeLarge } from './environment';

export const RECIPES: Recipe[] = [
  // structures
  commandHall, qiShrine, barracks, refinery, workshop, arrowTower, wall,
  // units
  halberdier, archer, daoist, woodenOx, caravan,
  // resources
  jadeSmall, jadeLarge,
  // environment
  pine, bamboo, peachTree, rock, scholarRock,
];
