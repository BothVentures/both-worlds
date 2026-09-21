import type { Entity, Relation, TourStep, WorldData } from '../model/types'
import meta from './meta.json'
import bothOs from './entities.both-os.json'
import toolkit from './entities.synergy-toolkit.json'
import lcChaman from './entities.lc-chaman.json'
import relations from './relations.json'
import tour from './tour.json'

export const world: WorldData = {
  meta: meta as WorldData['meta'],
  entities: [...(bothOs as Entity[]), ...(toolkit as Entity[]), ...(lcChaman as Entity[])],
  relations: relations as Relation[],
  tour: tour as TourStep[],
}
