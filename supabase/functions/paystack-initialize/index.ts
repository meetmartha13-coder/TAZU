import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return reply({error:"Method not allowed"},405);
  try {
    const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, secret=Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!url || !anon || !service || !secret) return reply({error:"Payment service is not configured."},500);
    const auth=req.headers.get("Authorization"); if(!auth) return reply({error:"Sign in before paying."},401);
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user},error:userErr}=await userClient.auth.getUser();
    if(userErr||!user) return reply({error:"Please sign in again."},401);
    const body=await req.json(); const rideId=String(body.ride_id||"");
    if(!rideId) return reply({error:"ride_id is required."},400);
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const {data:ride,error}=await admin.from("rides").select("id,passenger_id,estimated_fare_ngn,payment_method,payment_status,status").eq("id",rideId).maybeSingle();
    if(error) throw error;
    if(!ride||ride.passenger_id!==user.id) return reply({error:"Ride not found for this passenger."},404);
    if(ride.status==="cancelled"||ride.payment_status==="paid") return reply({error:"This ride cannot be paid in its current state."},409);
    const fare=Number(ride.estimated_fare_ngn); if(!Number.isInteger(fare)||fare<=0) return reply({error:"Invalid ride fare."},400);
    const reference="tazu_"+ride.id+"_"+crypto.randomUUID().replaceAll("-","");
    const {data:saved,error:saveErr}=await admin.from("rides").update({payment_status:"pending",payment_reference:reference}).eq("id",ride.id).neq("payment_status","paid").select("id").maybeSingle();
    if(saveErr) throw saveErr; if(!saved) return reply({error:"Could not prepare payment. Refresh and retry."},409);
    const channel=ride.payment_method==="bank_transfer"?"bank_transfer":"card";
    const pay=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount:fare*100,currency:"NGN",reference,channels:[channel],callback_url:"https://meetmartha13-coder.github.io/TAZU/?payment=return",metadata:{ride_id:ride.id,passenger_id:user.id}})});
    const result=await pay.json();
    if(!pay.ok||!result.status||!result.data?.authorization_url){await admin.from("rides").update({payment_status:"failed"}).eq("id",ride.id).eq("payment_reference",reference);return reply({error:result.message||"Paystack initialization failed."},502);}
    return reply({authorization_url:result.data.authorization_url,reference,ride_id:ride.id});
  } catch(e) { return reply({error:e instanceof Error?e.message:"Unexpected payment error."},500); }
});