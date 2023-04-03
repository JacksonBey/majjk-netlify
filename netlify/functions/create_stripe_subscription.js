const BigCommerce = require('bigcommerce');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_API_KEY);
const bigCommerce = new BigCommerce({
  clientId: process.env.BIGCOMMERCE_CLIENT_ID,
  accessToken: process.env.BIGCOMMERCE_ACCESS_TOKEN,
  storeHash: process.env.BIGCOMMERCE_STORE_HASH,
  responseType: 'json',
});

// QUESTION: how is a subscription product identified?

// note: subscriptionLineItem, deliveryDateOption, billing_cycle_anchor finding subject to change depending on data structure
exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body);
    const orderId = payload.data.id;

    const order = await bigCommerce.get(`/orders/${orderId}`);
    const orderProducts = await bigCommerce.get(`/orders/${orderId}/products`);
    const consignments = await bigCommerce.get(`/orders/${orderId}/consignments`);

    // Find the subscription line item and related data
    // replace with subscription product SKU
    const subscriptionProductSku = 'sample-subscription-product'; 

    const subscriptionLineItem = sampleOrder.products.find(
      (product) => product.sku === subscriptionProductSku
    );

    if (subscriptionLineItem) {
      const deliveryDateOption = subscriptionLineItem.product_options.find(
        (option) => option.name === 'Delivery Date'
      );

      if (deliveryDateOption) {
        const deliveryDate = deliveryDateOption.value;
        console.log('Subscription product delivery date:', deliveryDate);
      } else {
        console.log('Delivery date option not found');
      }
    } else {
      console.log('Subscription line item not found');
    }



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
        /* map the order.billing_address fields to Stripe address fields */ 
        address: { 
          line1: order.billing_address.street_1,
          line2: order.billing_address.street_2,
          city: order.billing_address.city,
          state: order.billing_address.state,
          postal_code: order.billing_address.zip,
          country: order.billing_address.country_iso2,
        },
      });
    }


    // Parse the date modifier value into a JavaScript Date object
    const deliveryDate = new Date(dateModifierValue);

    // Calculate the timestamp (in seconds) for the billing_cycle_anchor
    const billingCycleAnchorTimestamp = Math.floor(deliveryDate.getTime() / 1000);

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: process.env.HARDCODED_SUBSCRIPTION_PRODUCT_ID }],
      /* calculate the timestamp based on the date modifier value */
      billing_cycle_anchor:  billingCycleAnchorTimestamp,
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



const sampleOrder = {
  id: 12345,
  billing_address: {/* ... */},
  email: 'john@example.com',
  products: [
    {
      id: 1,
      name: 'Sample Subscription Product',
      sku: 'sample-subscription-product',
      price: 9.99,
      product_options: [
        {
          id: 101,
          name: 'Delivery Date',
          value: '2023-04-10',
        },
      ],
    },
    {
      id: 2,
      name: 'Sample Non-Subscription Product',
      sku: 'sample-non-subscription-product',
      price: 19.99,
      product_options: [],
    },
  ],
};

const sampleBillingAddress = {
  first_name: 'John',
  last_name: 'Doe',
  company: 'Acme Inc.',
  street_1: '123 Main St',
  street_2: 'Apt 4B',
  city: 'New York',
  state: 'NY',
  zip: '10001',
  country: 'United States',
  country_iso2: 'US',
  phone: '555-123-4567',
  email: 'john.doe@example.com',
};
