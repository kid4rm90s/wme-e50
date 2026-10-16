import { NAME } from '../name'
import { Provider } from './base'

/**
 * Google Place
 * @link https://developers.google.com/places/web-service/search
 */
export class GoogleProvider extends Provider {
  key: string
  query: any
  // Live PlacesService pagination object (JS API: { hasNextPage, nextPage() })
  pagination: any = null
  loading = false
  fieldset: HTMLFieldSetElement | null = null
  private service: any = null
  private resolvePage: ((results: any[]) => void) | null = null
  private rejectPage: ((status: any) => void) | null = null

  constructor(container: any, settings: any, scriptSettings: any, wmeSDK: any, key: string) {
    super(WMEUI.t(NAME).providers.google, container, settings, scriptSettings, wmeSDK)
    this.key = key
  }

  /**
   * Routes both the first page and any later `pagination.nextPage()` page into
   * the promise that is currently awaiting results.
   */
  private onPage = (results: any, status: any, pagination: any) => {
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      this.pagination = pagination
      this.resolvePage?.(results)
    } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
      this.pagination = null
      this.resolvePage?.([])
    } else {
      this.rejectPage?.(status)
    }
  }

  /**
   * Google's pagination object is live and cannot be cached, so this provider
   * bypasses the shared cache and always fetches a fresh first page.
   */
  async search (lon: number, lat: number, radius: number = 1000): Promise<void> {
    this.query = { lon, lat, radius }
    this.response = await this.request(lon, lat, radius).catch(() => [])
  }

  async request (lon: number, lat: number, radius: number): Promise<any[]> {
    this.pagination = null

    let results = await this.searchPage({
      location: new google.maps.LatLng(lat, lon),
      radius: radius,
      type: 'point_of_interest',
    }).catch(e => null)

    console.groupCollapsed(this.uid)
    let result: any[] = []
    if (results?.length) {
      result = this.sortByDistance(this.collection(results), lon, lat, radius)
    } else {
      console.info('No response returned')
    }
    console.groupEnd()
    return result
  }

  /**
   * Google returns places by prominence and treats `radius` as a bias, so it may
   * return places outside it. Keep only the ones inside the radius, sorted by
   * distance from the searched point (the venue centroid).
   */
  private sortByDistance (items: any[], lon: number, lat: number, radius: number): any[] {
    let center = turf.point([lon, lat])
    for (let item of items) {
      item.distance = turf.distance(center, turf.point([item.lon, item.lat]), { units: 'meters' })
    }
    return items
      .filter(item => item.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
  }

  /**
   * Run a Nearby Search page. Google returns at most 20 places per request and
   * caps a search at 60, so further pages must be pulled by the user.
   */
  private searchPage (request: any): Promise<any[]> {
    if (!this.service) {
      let map = new google.maps.Map(document.createElement('div'))
      this.service = new google.maps.places.PlacesService(map)
    }
    return new Promise((resolve, reject) => {
      this.resolvePage = resolve
      this.rejectPage = reject
      this.service.nearbySearch(request, this.onPage)
    })
  }

  /**
   * Add the "Load more" row when another page is available
   */
  _fieldset (): HTMLFieldSetElement {
    let fieldset = super._fieldset()
    this.fieldset = fieldset
    if (this.pagination?.hasNextPage) {
      this.addLoadMore(fieldset)
    }
    return fieldset
  }

  private addLoadMore (fieldset: HTMLFieldSetElement) {
    let list = fieldset.querySelector('ul')
    if (!list) return
    let li = document.createElement('li')
    let link = document.createElement('a')
    link.href = '#'
    link.className = NAME.toLowerCase() + '-load-more'
    link.innerText = WMEUI.t(NAME).loadMore
    link.onclick = (event: any) => {
      event.preventDefault()
      this.loadMore(link)
      return false
    }
    li.append(link)
    list.append(li)
  }

  /**
   * Fetch and append the next page of places
   */
  async loadMore (link: HTMLAnchorElement) {
    if (this.loading || !this.pagination?.hasNextPage) return
    this.loading = true

    let list = this.fieldset?.querySelector('ul')
    let label = link.innerText
    link.innerText = WMEUI.t(NAME).loading

    try {
      // nextPage() re-invokes the callback registered with the first search
      let results = await new Promise<any[]>((resolve, reject) => {
        this.resolvePage = resolve
        this.rejectPage = reject
        this.pagination.nextPage()
      })

      let seen = new Set(this.response.map((x: any) => x.reference))
      for (let res of results) {
        if (!res.place_id || seen.has(res.place_id)) continue
        seen.add(res.place_id)
        this.response.push(this.item(res))
      }

      // Keep the whole list within the radius, in distance order; rebuild it,
      // leaving the "Load more" row last
      this.response = this.sortByDistance(this.response, this.query.lon, this.query.lat, this.query.radius)
      if (list && link.parentElement) {
        let loadMore = link.parentElement
        for (let li of Array.from(list.children)) {
          if (li !== loadMore) li.remove()
        }
        for (let item of this.response) {
          let li = document.createElement('li')
          li.append(this._link(item))
          list.insertBefore(li, loadMore)
        }
      }

      let count = this.fieldset?.querySelector('legend span')
      if (count) count.textContent = String(this.response.length)

      if (this.pagination?.hasNextPage) {
        link.innerText = label
      } else if (link.parentElement) {
        link.parentElement.remove()
      }
    } catch (e) {
      console.warn('Google: could not load more places', e)
      link.innerText = label
    } finally {
      this.loading = false
    }
  }

  item(res: any): any {
    let address = res.vicinity.split(',')
    address = address.map((str: string) => str.trim())

    // looks like hell
    let street = address[0] && address[0].length > 4 ? address[0] : ''
    let number = address[1] && address[1].length < 13 ? address[1] : ''
    let city = address[2] ? address[2] : ''

    return this.element(
      res.geometry.location.lng(),
      res.geometry.location.lat(),
      city,
      street,
      number,
      res.name,
      res.place_id || res.reference
    )
  }

  /**
   * Details about a specific object or entity.
   *
   * This variable is used to encapsulate information or attributes
   * related to a particular subject. The structure and type of the
   * details may vary depending on the specific application or use-case.
   */
  static async makeDetailsRequest(reference: string): Promise<any> {
    // We need a map instance to initialize the service (even a dummy one)
    let map = new google.maps.Map(document.createElement('div'))
    let service = new google.maps.places.PlacesService(map)

    let request = {
      placeId: reference, // Google now uses placeId instead of reference
      // Specifying fields is cheaper and faster
      fields: [
        'business_status', 'geometry', 'name', 'place_id', 'vicinity',
        'formatted_phone_number', 'international_phone_number', 'website', 'opening_hours'
      ]
    }

    return new Promise((resolve, reject) => {
      service.getDetails(request, (place: any, status: any) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
          resolve(place)
        } else {
          reject(status)
        }
      })
    })
  }
}

/**
 * Convert Google `opening_hours.periods` into the WME SDK shape:
 * `[{ days: [0..6], fromHour: "HH:MM", toHour: "HH:MM" }]`
 * (day 0 = Sunday … 6 = Saturday, same as Google).
 *
 * WME rejects overlapping ranges on the same day, but Google sometimes lists
 * both an all-day and a timed period for the same day (e.g. 24/7 chains), so
 * same-day overlaps are resolved (all-day wins, otherwise the widest range).
 */
export function parseOpeningHours (place: any): any[] | null {
  const periods = place?.opening_hours?.periods
  if (!Array.isArray(periods) || !periods.length) return null

  const toTime = (value: any): string | null => {
    const s = String(value ?? '').padStart(4, '0')
    return /^\d{4}$/.test(s) ? s.slice(0, 2) + ':' + s.slice(2) : null
  }

  const expanded: any[] = []
  for (const period of periods) {
    const open = period?.open
    const close = period?.close
    if (!open || typeof open.day !== 'number') continue
    const fromHour = toTime(open.time)
    if (!fromHour) continue

    // No closing time means 24/7
    if (!close) return [{ days: [0, 1, 2, 3, 4, 5, 6], fromHour: '00:00', toHour: '00:00' }]
    if (typeof close.day !== 'number') continue
    const toHour = toTime(close.time)
    if (!toHour) continue

    if (open.day === close.day) {
      const allDay = open.time === close.time
      expanded.push({ day: open.day, fromHour: allDay ? '00:00' : fromHour, toHour: allDay ? '00:00' : toHour })
      continue
    }

    // Overnight: open day until end, intermediate days full, close day from start
    expanded.push({ day: open.day, fromHour, toHour: '23:59' })
    let day = (open.day + 1) % 7
    let guard = 0
    while (day !== close.day && guard < 7) {
      expanded.push({ day, fromHour: '00:00', toHour: '23:59' })
      day = (day + 1) % 7
      guard++
    }
    expanded.push({ day: close.day, fromHour: '00:00', toHour })
  }

  // Group identical time ranges
  const grouped = new Map<string, any>()
  for (const item of expanded) {
    const key = item.fromHour + '|' + item.toHour
    if (!grouped.has(key)) grouped.set(key, { days: [], fromHour: item.fromHour, toHour: item.toHour })
    grouped.get(key).days.push(item.day)
  }
  const entries = [...grouped.values()].map(e => ({ ...e, days: [...new Set(e.days)] }))

  // Resolve same-day overlaps: an all-day entry wins, otherwise the widest
  const isAllDay = (e: any) => e.fromHour === '00:00' && e.toHour === '00:00'
  const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  for (let day = 0; day <= 6; day++) {
    const owners = entries.filter(e => e.days.includes(day))
    if (owners.length <= 1) continue
    let winner = owners.find(isAllDay) || owners[0]
    for (const e of owners) {
      if (isAllDay(winner)) break
      const best = isAllDay(winner) ? 1440 : minutes(winner.toHour) - minutes(winner.fromHour)
      const wide = isAllDay(e) ? 1440 : minutes(e.toHour) - minutes(e.fromHour)
      if (wide > best) winner = e
    }
    for (const e of owners) if (e !== winner) e.days = e.days.filter((d: number) => d !== day)
  }

  // Re-group after overlap removal, drop empties, sort deterministically
  const merged = new Map<string, any>()
  for (const e of entries) {
    if (!e.days.length) continue
    const key = e.fromHour + '|' + e.toHour
    if (!merged.has(key)) merged.set(key, { days: [], fromHour: e.fromHour, toHour: e.toHour })
    merged.get(key).days.push(...e.days)
  }

  return [...merged.values()]
    .map(e => ({ days: [...new Set(e.days)].sort((a: number, b: number) => a - b), fromHour: e.fromHour, toHour: e.toHour }))
    .sort((a, b) => (a.fromHour + a.toHour).localeCompare(b.fromHour + b.toHour))
}
