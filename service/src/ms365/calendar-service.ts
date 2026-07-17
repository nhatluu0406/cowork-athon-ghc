/**
 * CalendarService: Outlook Calendar over Microsoft Graph. Reads list/search events; the one
 * write (create a meeting) goes through the PermissionGate at the tool-call boundary, exactly
 * like Planner/Lists/Teams writes — this service itself has no gating, only the Graph call.
 */
import { Ms365Error } from "./ms365-errors.js";
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 50;

export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  organizer: string;
}

export interface CreateEventInput {
  subject: string;
  start: string;
  end: string;
  attendees?: string[];
  online?: boolean;
  timezone?: string;
}

export interface CalendarService {
  listEvents(input: { start: string; end: string }): Promise<CalendarEvent[]>;
  searchEvents(query: string): Promise<CalendarEvent[]>;
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
}

interface RawEvent {
  id?: unknown;
  subject?: unknown;
  start?: { dateTime?: unknown };
  end?: { dateTime?: unknown };
  organizer?: { emailAddress?: { name?: unknown } };
}
interface EventsResponse {
  value?: RawEvent[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function toEvent(raw: RawEvent): CalendarEvent | null {
  if (typeof raw?.id !== "string" || typeof raw?.subject !== "string") return null;
  return {
    id: raw.id,
    subject: raw.subject,
    start: str(raw.start?.dateTime),
    end: str(raw.end?.dateTime),
    organizer: str(raw.organizer?.emailAddress?.name),
  };
}

export function createCalendarService(deps: { connector: Ms365Connector; maxResults?: number }): CalendarService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const graph = () => deps.connector.graph();

  return {
    async listEvents(input) {
      const response = await graph().json<EventsResponse>({
        method: "GET",
        path: "/me/calendarView",
        query: {
          startDateTime: input.start,
          endDateTime: input.end,
          $orderby: "start/dateTime",
          $select: "subject,start,end,organizer,id",
          $top: String(cap),
        },
      });
      const out: CalendarEvent[] = [];
      for (const raw of asArray(response.value)) {
        const e = toEvent(raw);
        if (e !== null) out.push(e);
        if (out.length >= cap) break;
      }
      return out;
    },

    async searchEvents(query: string) {
      const response = await graph().json<EventsResponse>({
        method: "GET",
        path: "/me/events",
        // Model query is the $search VALUE only (never the path), matching OutlookService.
        query: { $search: `"${query.replace(/"/g, '\\"')}"`, $select: "subject,start,end,id", $top: String(cap) },
      });
      const out: CalendarEvent[] = [];
      for (const raw of asArray(response.value)) {
        const e = toEvent(raw);
        if (e !== null) out.push(e);
        if (out.length >= cap) break;
      }
      return out;
    },

    async createEvent(input) {
      const tz = input.timezone ?? "UTC";
      const body: Record<string, unknown> = {
        subject: input.subject,
        start: { dateTime: input.start, timeZone: tz },
        end: { dateTime: input.end, timeZone: tz },
        attendees: (input.attendees ?? []).map((address) => ({
          emailAddress: { address },
          type: "required",
        })),
      };
      if (input.online === true) {
        body.isOnlineMeeting = true;
        body.onlineMeetingProvider = "teamsForBusiness";
      }
      const raw = await graph().json<RawEvent>({ method: "POST", path: "/me/events", body });
      const e = toEvent(raw);
      if (e === null) {
        throw new Ms365Error(
          "graph_error",
          "Calendar create response missing id/subject.",
          "Thử lại; nếu tiếp diễn hãy kết nối lại Microsoft 365.",
          false,
        );
      }
      return e;
    },
  };
}
