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
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid request payload' }),
      };
    }
    const payload = JSON.parse(event.body);

    if (!payload || !payload.data || !payload.data.id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid request payload' }),
      };
    }

    const orderId = payload.data.id;
    console.log('orderId', orderId)

    const order = await bigCommerce.get(`/orders/${orderId}`);

    const orderProducts = await bigCommerce.get(`/orders/${orderId}/products?include=options`);
    console.log('orderProductsResponse', orderProducts)

    // Find the subscription line item and related data
    const subscriptionLineItem = orderProducts.find(
      (product) => product.sku === process.env.HARDCODED_SUBSCRIPTION_PRODUCT_SKU
    );

    if (subscriptionLineItem) {
      // deliveryDateOption = subscriptionLineItem.product_options.find(
      //   (option) => option.name === 'Delivery Date'
      // );
      console.log('subscriptionLineItem', subscriptionLineItem.product_id)
      let customFieldsResponse;
      const customFieldsUrl = `https://${process.env.STORE_HASH}.mybigcommerce.com/api/v2/products/${subscriptionLineItem.product_id}/custom_fields.json`;
      try {
        customFieldsResponse = await bigCommerce.get(customFieldsUrl);
      } catch (error) {
        console.error(`Error fetching custom fields for product ${subscriptionLineItem.product_id}:`, error);
        customFieldsResponse = { data: [] }; // Set an empty custom fields array if an error occurs
      }
      console.log('customFieldsResponse', customFieldsResponse)
      
      const customFields = customFieldsResponse.data;

      const productOptions = subscriptionLineItem.product_options;
      console.log('productOptions', productOptions)
      // productOptions [ { id: 101, name: 'Delivery Date', value: '2023-04-10' } ] 
      const deliveryDateOption = productOptions.find(option => option.display_name == 'Pick-up Date');
      console.log('deliveryDateOption', deliveryDateOption)
   
      const stripeProductIdField = customFields.find(field => field.name === 'Stripe Product ID');
      const stripePriceIdField = customFields.find(field => field.name === 'Stripe Price ID');
      
      // const stripeProductId = stripeProductIdField ? stripeProductIdField.value : null;
      // const stripePriceId = stripePriceIdField ? stripePriceIdField.value : null;

      let stripeCustomer = await stripe.customers.list({ email: order.email });
      const stripeCustomerId = stripeCustomer.data[0].id;
      const paymentMethods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
      });
      

      if (deliveryDateOption) {
        const deliveryDate = deliveryDateOption.value;
        console.log('Subscription product delivery date:', deliveryDate);
      } else {
        console.log('Delivery date option not found');
      }

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
      // const deliveryDate = new Date(deliveryDateOption.value);
      const deliveryDate = new Date(deliveryDateOption.value);
      console.log('PAYMENT METHODS: ', paymentMethods)
      const paymentMethod = {
        "id": "pm_1MtP1ZGOO2ZYN95SudtSjigR",
        "object": "payment_method",
        "billing_details": {
          "address": {
            "city": "Bainbridge Island",
            "country": "US",
            "line1": "8380 NE Blakely HT DR",
            "line2": "",
            "postal_code": "98110",
            "state": "Washington"
          },
          "email": "jenny@example.com",
          "name": null,
          "phone": "+15555555555"
        },
        "card": {
          "brand": "visa",
          "checks": {
            "address_line1_check": null,
            "address_postal_code_check": null,
            "cvc_check": "pass"
          },
          "country": "US",
          "exp_month": 8,
          "exp_year": 2024,
          "fingerprint": "VfuRmak5kDcHcsFK",
          "funding": "credit",
          "generated_from": null,
          "last4": "4242",
          "networks": {
            "available": [
              "visa"
            ],
            "preferred": null
          },
          "three_d_secure_usage": {
            "supported": true
          },
          "wallet": null
        },
        "created": 123456789,
        "customer": null,
        "livemode": false,
        "metadata": {
          "order_id": "123456789"
        },
        "type": "card"
      }
      const defaultPaymentMethod = paymentMethods?.data[0]?.id;
      const subscriptionCreateParams = {
        customer: stripeCustomer.id,
        default_payment_method: defaultPaymentMethod,
        items: [{ price: "price_1Mst3NGOO2ZYN95StCmNH1ub" }], // box of chocolates stripe price
        ...(isNaN(deliveryDate) ? {} : { billing_cycle_anchor: deliveryDate })
      };

      // Calculate the timestamp (in seconds) for the billing_cycle_anchor
      const billingCycleAnchorTimestamp = Math.floor(deliveryDate.getTime() / 1000);

      console.log('subscription create: ', subscriptionCreateParams)

      console.log('subscriptiopnline item: ', subscriptionLineItem)

      // const subscription = await stripe.subscriptions.create({
      //   customer: stripeCustomer.id,
      //   items: [{ price: "price_1Mst3NGOO2ZYN95StCmNH1ub"}],
      //   /* calculate the timestamp based on the date modifier value */
      //   billing_cycle_anchor:  billingCycleAnchorTimestamp,
      // });
      const subscription = await stripe.subscriptions.create(subscriptionCreateParams);

      console.log('SUBSCRIPTISON: ', subscription)

      // await bigCommerce.post(`/orders/${orderId}/order_messages`, {
      //   message: `Stripe subscription ID: ${subscription.id}`,
      //   staff_only: true,
      // });

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Subscription created successfully' }),
      };
    } else {
      console.log('Subscription line item not found');
    }
  } catch (error) {
    console.error('Error processing subscription:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error processing subscription' }),
    };
  }
};