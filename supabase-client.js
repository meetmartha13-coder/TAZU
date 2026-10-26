/* TAZU real-time backend client.
 * Load Supabase JS v2 in the page before this file, then call TAZUCloud.configure(url, publishableKey).
 * Only the publishable/anon key belongs in browser code. Never put a service_role/secret key here.
 */
(function (global) {
  const state = { client: null, channel: null };
  function requireClient() {
    if (!state.client) throw new Error('TAZU cloud is not configured. Add your Supabase project URL and publishable key first.');
    return state.client;
  }
  const api = {
    configure(url, publishableKey) {
      if (!global.supabase || !global.supabase.createClient) throw new Error('Supabase JS library did not load. Check your internet connection.');
      if (!url || !publishableKey) throw new Error('Project URL and publishable key are required.');
      state.client = global.supabase.createClient(url, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return true;
    },
    client() { return requireClient(); },
    async signUp(email, password, fullName, role) {
      const c = requireClient();
      const { data, error } = await c.auth.signUp({ email, password, options: { data: { full_name: fullName || '', requested_role: role || 'passenger' } } });
      if (error) throw error;
      return data;
    },
    async signIn(email, password) {
      const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signOut() {
      const { error } = await requireClient().auth.signOut();
      if (error) throw error;
    },
    async currentUser() {
      const c = requireClient();
      const { data: sessionData, error: sessionError } = await c.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) return null;
      const { data, error } = await c.auth.getUser();
      if (error) throw error;
      return data.user || null;
    },
    async requestRide(input) {
      const c = requireClient();
      const user = await this.currentUser();
      if (!user) throw new Error('Sign in before requesting a ride.');
      const row = {
        passenger_id: user.id,
        pickup_label: String(input.pickup || '').trim(),
        destination_label: String(input.destination || '').trim(),
        pickup_lat: input.pickupLat ?? null,
        pickup_lng: input.pickupLng ?? null,
        destination_lat: input.destinationLat ?? null,
        destination_lng: input.destinationLng ?? null,
        ride_type: input.rideType || 'Economy',
        estimated_fare_ngn: Math.round(Number(input.fare)),
        commission_rate: Number(input.commissionRate ?? 15),
        payment_method: input.paymentMethod || 'card',
        status: 'requested',
        payment_status: 'unpaid'
      };
      if (!row.pickup_label || !row.destination_label || !Number.isFinite(row.estimated_fare_ngn) || row.estimated_fare_ngn < 0) throw new Error('Enter valid pickup, destination and fare.');
      const { data, error } = await c.from('rides').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    async pendingRides() {
      const { data, error } = await requireClient().from('rides').select('*').eq('status', 'requested').is('driver_id', null).order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    async subscribeToRides(onChange) {
      const c = requireClient();
      if (state.channel) await c.removeChannel(state.channel);
      state.channel = c.channel('tazu-rides-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, payload => onChange(payload)).subscribe();
      return () => { if (state.channel) c.removeChannel(state.channel); state.channel = null; };
    },
    async myRides() {
      const user = await this.currentUser();
      if (!user) throw new Error('Sign in first.');
      const { data, error } = await requireClient().from('rides').select('*').or(`passenger_id.eq.${user.id},driver_id.eq.${user.id}`).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async setDriverOnline(isOnline) {
      const user = await this.currentUser();
      if (!user) throw new Error('Sign in first.');
      const { data, error } = await requireClient().from('drivers').update({ is_online: !!isOnline, updated_at: new Date().toISOString() }).eq('user_id', user.id).select().single();
      if (error) throw error;
      return data;
    },
    async updateDriverLocation(lat, lng) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid GPS coordinates.');
      const user = await this.currentUser();
      if (!user) throw new Error('Sign in first.');
      const { data, error } = await requireClient().from('drivers').update({ lat, lng, location_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', user.id).select().single();
      if (error) throw error;
      return data;
    }
  };
  global.TAZUCloud = api;
})(window);
