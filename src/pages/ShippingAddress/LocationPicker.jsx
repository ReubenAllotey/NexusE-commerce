import { useEffect, useRef, useState } from "react";

const GOOGLE_MAPS_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
let googleMapsPromise;

function clean(value) {
  return String(value ?? "").trim();
}

function loadGoogleMaps() {
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error("Google Maps is not configured."));
  if (window.google?.maps?.places) return Promise.resolve(window.google.maps);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-nexus-google-maps="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps));
      existing.addEventListener("error", () => reject(new Error("Google Maps could not be loaded.")));
      return;
    }
    const script = document.createElement("script");
    script.dataset.nexusGoogleMaps = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("Google Maps could not be loaded."));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function componentValue(components = [], type) {
  return components.find((component) => component.types?.includes(type))?.long_name || "";
}

function addressFromPlace(place = {}, coordinates = {}) {
  const components = place.address_components || [];
  const latitude = Number(coordinates.latitude ?? place.geometry?.location?.lat?.());
  const longitude = Number(coordinates.longitude ?? place.geometry?.location?.lng?.());
  const region = componentValue(components, "administrative_area_level_1");
  const city = componentValue(components, "locality") || componentValue(components, "sublocality") || componentValue(components, "administrative_area_level_2");
  return {
    formattedAddress: clean(place.formatted_address),
    country: componentValue(components, "country") || "Ghana",
    region,
    city,
    streetAddress: [componentValue(components, "street_number"), componentValue(components, "route")].filter(Boolean).join(" "),
    postalCode: componentValue(components, "postal_code"),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function addressFromGeocode(result, coordinates) {
  return addressFromPlace({ ...result, address_components: result.address_components, formatted_address: result.formatted_address }, coordinates);
}

export default function LocationPicker({ savedAddresses = [], initialAddress = null, onConfirm = () => {}, onError = () => {} }) {
  const searchRef = useRef(null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const geocoderRef = useRef(null);
  const [candidate, setCandidate] = useState(initialAddress ? { ...initialAddress } : null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    loadGoogleMaps().then((maps) => {
      if (!active) return;
      setMapsReady(true);
      const autocomplete = new maps.places.Autocomplete(searchRef.current, { componentRestrictions: { country: "gh" }, fields: ["address_components", "formatted_address", "geometry"] });
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) {
          setMapsError("Choose an address from the suggestions so we can locate it.");
          return;
        }
        setCandidate(addressFromPlace(place));
      });
    }).catch((error) => {
      if (active) setMapsError(error.message || "Location search is unavailable.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;
    const maps = window.google.maps;
    const fallback = { lat: Number(candidate?.latitude) || 5.6037, lng: Number(candidate?.longitude) || -0.1870 };
    mapInstanceRef.current = new maps.Map(mapRef.current, { center: fallback, zoom: candidate?.latitude ? 16 : 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    markerRef.current = new maps.Marker({ map: mapInstanceRef.current, position: fallback, draggable: true, title: "Delivery location" });
    geocoderRef.current = new maps.Geocoder();
    const updateFromLatLng = (latLng) => {
      setLoading(true);
      geocoderRef.current.geocode({ location: latLng }, (results, status) => {
        setLoading(false);
        if (status === "OK" && results?.[0]) setCandidate(addressFromGeocode(results[0], { latitude: latLng.lat(), longitude: latLng.lng() }));
        else setMapsError("We could not identify that map point. Try moving the pin slightly.");
      });
    };
    markerRef.current.addListener("dragend", (event) => updateFromLatLng(event.latLng));
    mapInstanceRef.current.addListener("click", (event) => {
      markerRef.current.setPosition(event.latLng);
      updateFromLatLng(event.latLng);
    });
    return () => { mapInstanceRef.current = null; markerRef.current = null; };
  }, [mapsReady]);

  useEffect(() => {
    if (!mapInstanceRef.current || !markerRef.current || !candidate?.latitude || !candidate?.longitude) return;
    const position = { lat: Number(candidate.latitude), lng: Number(candidate.longitude) };
    mapInstanceRef.current.setCenter(position);
    mapInstanceRef.current.setZoom(16);
    markerRef.current.setPosition(position);
  }, [candidate?.latitude, candidate?.longitude]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMapsError("This browser does not support location detection.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition((position) => {
      const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ location: { lat: coordinates.latitude, lng: coordinates.longitude } }, (results, status) => {
          setLoading(false);
          if (status === "OK" && results?.[0]) setCandidate(addressFromGeocode(results[0], coordinates));
          else setMapsError("Your location was found, but the address could not be formatted.");
        });
      } else {
        setLoading(false);
        setCandidate({ ...candidate, ...coordinates, formattedAddress: "Current map location", country: "Ghana" });
      }
    }, () => { setLoading(false); setMapsError("Location permission was denied. Search for your address or choose a saved location."); }, { enableHighAccuracy: true, timeout: 10000 });
  }

  return (
    <section className="location-picker" aria-label="Choose delivery location">
      <div className="location-picker__header"><div><p className="shipping-panel__eyebrow">Delivery location</p><h2>Where should we deliver?</h2><span>Search an address, use your location, or move the pin to confirm the exact point.</span></div></div>
      <div className="location-picker__search"><input ref={searchRef} type="search" placeholder="Search Ghana delivery address" aria-label="Search delivery address" /><div className="location-picker__search-actions"><button type="button" className="shipping-panel__link" onClick={useCurrentLocation} disabled={loading}>{loading ? "Locating..." : "Use My Current Location"}</button><button type="button" className="shipping-panel__link" onClick={() => { setMapsError(""); mapRef.current?.focus(); }}>Choose on Map</button></div></div>
      {savedAddresses.length > 0 ? <div className="location-picker__saved"><strong>Saved delivery locations</strong><div>{savedAddresses.map((address) => <button type="button" key={address.id} onClick={() => setCandidate({ ...address, formattedAddress: [address.city, address.region, address.country].filter(Boolean).join(", ") })}>{address.addressLabel || "Saved address"}<small>{[address.city, address.region].filter(Boolean).join(", ")}</small></button>)}</div></div> : null}
      <div ref={mapRef} className="location-picker__map" tabIndex="-1" aria-label="Interactive delivery map">{!GOOGLE_MAPS_KEY ? <p>Map search is not configured yet. Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to enable Google Places and the interactive map.</p> : null}</div>
      {mapsError ? <p className="shipping-form__error">{mapsError}</p> : null}
      {candidate?.formattedAddress ? <div className="location-picker__selected"><strong>Selected location</strong><span>{candidate.formattedAddress}</span>{candidate.region || candidate.city ? <small>{[candidate.city, candidate.region, candidate.country].filter(Boolean).join(", ")}</small> : null}</div> : null}
      <div className="location-picker__actions"><button type="button" className="shipping-footer__button" disabled={!candidate?.formattedAddress || loading} onClick={() => onConfirm(candidate)}>Confirm Location</button></div>
      {!mapsReady && GOOGLE_MAPS_KEY && !mapsError ? <small className="shipping-form__helper">Loading Google Maps...</small> : null}
      {onError ? null : null}
    </section>
  );
}
