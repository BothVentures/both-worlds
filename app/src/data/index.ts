import type { Entity, Relation, TourStep, WorldData } from '../model/types'
import meta from './meta.json'
import bothOs from './entities.both-os.json'
import toolkit from './entities.synergy-toolkit.json'
import lcChaman from './entities.lc-chaman.json'
import bienal from './entities.bienal-punta-os.json'
import casa from './entities.casa-manantial-os.json'
import relations from './relations.json'
import tour from './tour.json'

export const world: WorldData = {
  meta: meta as WorldData['meta'],
  entities: [...(bothOs as Entity[]), ...(toolkit as Entity[]), ...(lcChaman as Entity[]), ...(bienal as Entity[]), ...(casa as Entity[])],
  relations: relations as Relation[],
  tour: tour as TourStep[],
}
