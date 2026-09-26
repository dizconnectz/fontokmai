import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { PlaceGazetteer, RoadFloodHistory } from './data';
import { foundFromPlace, searchPlaces, type FoundPlace } from './places';
import { searchPhoton } from './photon';
import { searchRoads } from './roads';
import type { RefState } from './useData';

type Road = RoadFloodHistory['roads'][number];
type Option = { type: 'place'; place: FoundPlace } | { type: 'road'; road: Road };
interface Landmarks {
  query: string;
  state: 'idle' | 'loading' | 'ready' | 'error';
  hits: FoundPlace[];
}
const WAIT_MS = 450;
const MIN_LANDMARK_QUERY = 3;
const ROAD_QUERY = /^(?:ถนน|ถ\.|ซอย|ซ\.)/;

export default function PlaceSearch({
  places,
  placesState,
  roads,
  roadsState,
  onOpen,
  onPlace,
  onRoad,
}: {
  places: PlaceGazetteer | null;
  placesState: RefState;
  roads: RoadFloodHistory | null;
  roadsState: RefState;
  /** the box got focus: time to load the lists it searches */
  onOpen: () => void;
  onPlace: (place: FoundPlace) => void;
  onRoad: (key: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, FoundPlace[]>());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [landmarks, setLandmarks] = useState<Landmarks>({ query: '', state: 'idle', hits: [] });
  const text = query.trim();

  const areaHits = useMemo(
    () => (places && text ? searchPlaces(places, text).map((p) => foundFromPlace(places, p)) : []),
    [places, text],
  );
  const roadHits = useMemo(
    () => (roads && text ? searchRoads(roads, text).slice(0, 4) : []),
    [roads, text],
  );
  // Landmarks come from Photon once typing pauses; the query leaves the browser only then.
  useEffect(() => {
    if (!open || text.length < MIN_LANDMARK_QUERY) {
      setLandmarks({ query: text, state: 'idle', hits: [] });
      return;
    }
    const known = cache.current.get(text);
    if (known) {
      setLandmarks({ query: text, state: 'ready', hits: known });
      return;
    }
    setLandmarks({ query: text, state: 'loading', hits: [] });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPhoton(text, controller.signal)
        .then((hits) => {
          cache.current.set(text, hits);
          setLandmarks({ query: text, state: 'ready', hits });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLandmarks({ query: text, state: 'error', hits: [] });
        });
    }, WAIT_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text, open]);

  const landmarkHits = landmarks.query === text ? landmarks.hits : [];
  const options: Option[] = [
    ...areaHits.map((place) => ({ type: 'place' as const, place })),
    ...roadHits.map((road) => ({ type: 'road' as const, road })),
    ...landmarkHits.map((place) => ({ type: 'place' as const, place })),
  ];
  const current = Math.min(active, options.length - 1);
  const optionId = (index: number) => `${id}-option-${index}`;
  const showing = open && text.length > 0;
  const roadMissing = ROAD_QUERY.test(text) && roads !== null && roadHits.length === 0;
  const waiting =
    placesState === 'loading' ||
    placesState === 'idle' ||
    (text.length >= MIN_LANDMARK_QUERY && landmarks.state === 'loading');

  const choose = (option: Option | undefined) => {
    if (!option) return;
    setOpen(false);
    input.current?.blur();
    if (option.type === 'road') {
      setQuery('');
      onRoad(option.road.key);
    } else {
      setQuery(option.place.title);
      onPlace(option.place);
    }
  };

  let index = -1;
  const renderGroup = (key: string, label: string, items: Option[]) =>
    items.length > 0 && (
      <ul role="group" aria-labelledby={`${id}-${key}`}>
        <li role="presentation" id={`${id}-${key}`} className="result-group">
          {label}
        </li>
        {items.map((option) => {
          index += 1;
          const at = index;
          return (
            <li
              key={option.type === 'road' ? `road:${option.road.key}` : option.place.id}
              id={optionId(at)}
              role="option"
              aria-selected={at === current}
              className={at === current ? 'is-active' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(at)}
              onClick={() => choose(option)}
            >
              {option.type === 'road' ? (
                <>
                  <span className="result-text">
                    <strong>
                      {option.road.kind === 'road'
                        ? `ถ.${option.road.name_th}`
                        : option.road.name_th}
                    </strong>
                    <small>
                      เคยมีรายงานน้ำท่วม {option.road.flood_days} วัน · ล่าสุด{' '}
                      {Number(option.road.last_date.slice(0, 4)) + 543}
                    </small>
                  </span>
                  <span className="result-kind road">ถนน</span>
                </>
              ) : (
                <>
                  <span className="result-text">
                    <strong>{option.place.title}</strong>
                    {option.place.detail && <small>{option.place.detail}</small>}
                  </span>
                  <span className="result-kind">{option.place.kind}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="place-search">
      <label className="search-box">
        <Search size={17} />
        <span className="sr-only">ค้นหาสถานที่</span>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={showing ? `${id}-listbox` : undefined}
          aria-activedescendant={showing && current >= 0 ? optionId(current) : undefined}
          value={query}
          placeholder="ค้นหาสถานที่ อำเภอ ตำบล หรือถนน"
          enterKeyHint="search"
          onFocus={(event) => {
            onOpen();
            setOpen(true);
            // a chosen place stays in the box; typing replaces it
            event.target.select();
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              if (options.length)
                setActive(
                  (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                    options.length,
                );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(options[Math.max(current, 0)]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </label>
      {showing && (
        <div className="search-results">
          <div role="listbox" id={`${id}-listbox`} aria-label="ผลค้นหา">
            {renderGroup('areas', 'พื้นที่', options.slice(0, areaHits.length))}
            {renderGroup(
              'roads',
              'ถนนที่เคยมีรายงานน้ำท่วม',
              options.slice(areaHits.length, areaHits.length + roadHits.length),
            )}
            {renderGroup('landmarks', 'สถานที่', options.slice(areaHits.length + roadHits.length))}
          </div>
          <div className="search-status" aria-live="polite">
            {placesState === 'loading' && <p>กำลังโหลดรายชื่อตำบล อำเภอ จังหวัด…</p>}
            {(placesState === 'missing' || placesState === 'error') && (
              <p>ยังค้นชื่อตำบล อำเภอ จังหวัดไม่ได้ในตอนนี้</p>
            )}
            {landmarks.query === text && landmarks.state === 'loading' && <p>กำลังค้นสถานที่…</p>}
            {landmarks.query === text && landmarks.state === 'error' && (
              <p>ค้นสถานที่อื่นไม่สำเร็จ · ยังค้นตำบล อำเภอ จังหวัดได้</p>
            )}
            {roadMissing && <p>ไม่พบรายงานของถนนนี้ใน กทม.–ปริมณฑล · ไม่ได้แปลว่าไม่เคยท่วม</p>}
            {ROAD_QUERY.test(text) && roadsState === 'loading' && (
              <p>กำลังโหลดประวัติน้ำท่วมถนน…</p>
            )}
            {!waiting && !roadMissing && options.length === 0 && (
              <p>ไม่พบ “{text}” · ลองพิมพ์ชื่อตำบล อำเภอ จังหวัด หรือชื่อสถานที่</p>
            )}
          </div>
          <p className="search-credit">
            พื้นที่: กรมการปกครอง (CC BY) · สถานที่: Photon ·{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              onMouseDown={(event) => event.preventDefault()}
            >
              © OpenStreetMap
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
