export const entities = [
  {
    id: 'terminal_tracking:terminal_config',
    label: 'Terminal Config',
    description: 'Container terminal API configuration with credentials and matching identifiers.',
    labelField: 'displayName',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
  {
    id: 'terminal_tracking:tracking_job',
    label: 'Terminal Tracking Job',
    description: 'A container tracked at a terminal.',
    labelField: 'containerNumber',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
  {
    id: 'terminal_tracking:terminal_event',
    label: 'Terminal Event',
    description: 'A normalized terminal event for a container.',
    labelField: 'eventCode',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
]

export default entities
