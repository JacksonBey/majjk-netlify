const BigCommerce = require('node-bigcommerce');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_API_KEY);
const bigCommerce = new BigCommerce({
  clientId: process.env.BIGCOMMERCE_CLIENT_ID,
  accessToken: process.env.BIGCOMMERCE_ACCESS_TOKEN,
  storeHash: process.env.BIGCOMMERCE_STORE_HASH,
  responseType: 'json',
});

// QUESTION: how is a subscription product identified?

// sample product id: 112
// sample order id: 100

// note: subscriptionLineItem, deliveryDateOption, billing_cycle_anchor finding subject to change depending on data structure
exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body);
    const orderId = payload.data.id;

    const order = await bigCommerce.get(`/orders/${orderId}`);
    const orderProducts = await bigCommerce.get(`/orders/${orderId}/products?include=lineItems.options`);
    
    const consignments = await bigCommerce.get(`/orders/${orderId}/consignments`);

    
    const customFields = customFieldsResponse.data;

    console.log('mergedOrderProducts', mergedOrderProducts);
    console.log('orderProductsWithCustomFields', orderProductsWithCustomFields);

    // console.log('OPTIONS', orderProducts[0].product_options);


    // Find the subscription line item and related data
    const subscriptionLineItem = mergedOrderProducts.products.find(
      (product) => product.sku === process.env.HARDCODED_SUBSCRIPTION_PRODUCT_SKU
    );

    if (subscriptionLineItem) {
      // deliveryDateOption = subscriptionLineItem.product_options.find(
      //   (option) => option.name === 'Delivery Date'
      // );
      const customFieldsResponse = await bigCommerce.get(
        `/catalog/products/${subscriptionLineItem.id}/custom-fields`
      );

      console.log('customFieldsResponse', customFieldsResponse)
      
      const customFields = customFieldsResponse.data;

      const productOptions = subscriptionLineItem.product_options;
      console.log('productOptions', productOptions)
      // productOptions [ { id: 101, name: 'Delivery Date', value: '2023-04-10' } ] 
      const deliveryDateOption = productOptions.find(option => option.name === 'Delivery Date');
   
      const stripeProductIdField = customFields.find(field => field.name === 'Stripe Product ID');
      const stripePriceIdField = customFields.find(field => field.name === 'Stripe Price ID');
      
      const stripeProductId = stripeProductIdField ? stripeProductIdField.value : null;
      const stripePriceId = stripePriceIdField ? stripePriceIdField.value : null;
      

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
    const deliveryDate = new Date(deliveryDateOption.value);

    // Calculate the timestamp (in seconds) for the billing_cycle_anchor
    const billingCycleAnchorTimestamp = Math.floor(deliveryDate.getTime() / 1000);

    console.log('subscription create: ', {
      customer: stripeCustomer.id,
      items: [{ price: stripePriceId }],
      /* calculate the timestamp based on the date modifier value */
      billing_cycle_anchor:  billingCycleAnchorTimestamp,
    })

    console.log('subscriptiopnline item: ', subscriptionLineItem)

    // const price = await stripe.prices.create({
    //   currency: 'usd',
    //   custom_unit_amount: {enabled: true},
    //   product: subscriptionLineItem.id ,
    // });

    // console.log('price: ', price)

    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: stripePriceId}],
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


const getOrderCUrl = { curl: `
curl -X GET \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: b6lh1ab3dz7eegnqyj0ityjs0blj5jf" \
  -H "X-Auth-Client: 84ht9px9puq9uy2yx40xpztwjy47ndq" \
  "https://api.bigcommerce.com/stores/q2dar3yy52/v3/orders/100?include=products
`}