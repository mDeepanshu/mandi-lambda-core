import * as repo from './item.repo';
import { AddItemRequestDTO } from './items.models';

export const createItems = (items: AddItemRequestDTO[]) =>
  repo.insertItems(items);

export const listItems = () =>
  repo.fetchAllItems();
