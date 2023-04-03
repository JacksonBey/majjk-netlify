const BigCommerce = require('bigcommerce');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_API_KEY);
const bigCommerce = new BigCommerce({
  clientId: process.env.BIGCOMMERCE_CLIENT_ID,
  accessToken: process.env.BIGCOMMERCE_ACCESS_TOKEN,
  storeHash: process.env.BIGCOMMERCE_STORE_HASH,
  responseType: 'json',
});

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body);
    const orderId = payload.data.id;

    const order = await bigCommerce.get(`/orders/${orderId}`);
    const orderProducts = await bigCommerce.get(`/orders/${orderId}/products`);
    const consignments = await bigCommerce.get(`/orders/${orderId}/consignments`);

    // Find the subscription line item and related data
    // ...

    let stripeCustomer;

    try {
      const customers = await stripe.customers.list({ email: order.email });
      stripeCustomer = customers.data[0];
    } catch (error) {
      console.error('Error fetching customer:', error);
    }

    if (!stripeCustomer) {
      stripeCustomer = await stripe.customers.create({
        email: order.email,
        name: `${order.billing_address.first_name} ${order.billing_address.last_name}`,
        address: { /* map the order.billing_address fields to Stripe address fields */ },
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: process.env.HARDCODED_SUBSCRIPTION_PRODUCT_ID }],
      billing_cycle_anchor: /* calculate the timestamp based on the date modifier value */,
    });

    await bigCommerce.post(`/orders/${orderId}/messages`, {
      message: `Stripe subscription ID: ${subscription.id}`,
      staff_only: true,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Subscription created successfully' }),
    };
  } catch (error) {
    console.error('Error processing subscription:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error processing subscription' }),
    };
  }
};
