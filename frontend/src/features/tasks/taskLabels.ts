import type { Category, TaskPriority, TaskStatus } from '../../api/bridge';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Low priority',
  MEDIUM: 'Medium priority',
  HIGH: 'High priority',
};

export const PRIORITY_NAMES: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export const STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'DONE'];
export const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

export function categoryName(category: Category): string {
  return category.archivedAt ? `${category.name} (archived)` : category.name;
}
