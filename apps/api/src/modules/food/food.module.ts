import { BadRequestException, Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../core/access/decorators';
import { ZodPipe } from '../../core/common/zod.pipe';
import { AccessModule } from '../../core/access/access.module';
import { AuthModule } from '../../core/auth/auth.module';
import { EventsModule } from '../../core/events/events.module';
import { MetadataModule } from '../../core/metadata/metadata.module';
import { WorkflowModule } from '../../core/workflow/workflow.module';
import { DataService } from '../../core/metadata/data.service';
import { FoodService } from './food.service';
import { FoodAutopilot, FoodDispatchConsumer } from './food.automation';

const Id = z.string().min(1).max(64);
const Cart = z.object({
  restaurantId: Id,
  items: z.array(z.object({ id: Id, qty: z.number().int().min(1).max(20) })).min(1).max(40),
  coupon: z.string().max(30).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
const PlaceOrder = Cart.extend({
  address: z.string().min(5).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  paymentMethod: z.enum(['upi', 'card', 'cod']),
  notes: z.string().max(300).optional(),
});
const Signup = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(10, 'Min 10 characters').max(128).regex(/[A-Z]/, 'Needs an uppercase letter').regex(/[a-z]/, 'Needs a lowercase letter').regex(/\d/, 'Needs a number'),
});
const Rate = z.object({ foodRating: z.number().int().min(1).max(5), riderRating: z.number().int().min(1).max(5).optional(), review: z.string().max(500).optional() });
const Reason = z.object({ reason: z.string().max(300).optional() });
const PartnerAction = z.object({ comment: z.string().max(300).optional() });
const RestaurantPatch = z.object({ isOpen: z.boolean().optional(), prepMinutes: z.number().int().min(3).max(90).optional(), offer: z.string().max(60).optional() });
const MenuPatch = z.object({ available: z.boolean().optional(), price: z.number().min(1).max(10000).optional(), bestseller: z.boolean().optional() });
const MenuNew = z.object({
  restaurantId: Id.optional(), name: z.string().min(2).max(80), price: z.number().min(1).max(10000), category: z.string().min(2).max(40),
  veg: z.boolean(), emoji: z.string().max(8).optional(), description: z.string().max(300).optional(),
});
const Online = z.object({ online: z.boolean() });
function oneOf<T extends string>(value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) throw new BadRequestException(`Unknown action "${value}"`);
  return value as T;
}

@Controller('food')
export class FoodController {
  constructor(private readonly food: FoodService, private readonly data: DataService) {}

  // Catalogue: public (tenant from X-Tenant)
  @Public() @Get('restaurants') restaurants() { return this.food.restaurants(); }
  @Public() @Get('restaurants/:id') restaurant(@Param('id') id: string) { return this.food.restaurant(id); }
  @Public() @Get('search') search(@Query('q') q = '') { return this.food.search(String(q)); }
  @Public() @Get('offers') offers() { return this.food.offers(); }
  @Public() @HttpCode(200) @Post('quote')
  async quote(@Body(new ZodPipe(Cart)) body: z.infer<typeof Cart>) {
    const { restaurant, ...bill } = await this.food.quote(body);
    return { ...bill, restaurant: { id: restaurant.id, name: restaurant.name, isOpen: restaurant.isOpen } };
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('signup')
  signup(@Body(new ZodPipe(Signup)) body: z.infer<typeof Signup>, @Req() req: Request) {
    return this.food.signup(body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  // Customer
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Post('orders')
  place(@Body(new ZodPipe(PlaceOrder)) body: z.infer<typeof PlaceOrder>) { return this.food.placeOrder(body); }
  @Get('orders/mine') mine() { return this.food.myOrders(); }
  @Get('orders/:id/track') track(@Param('id') id: string) { return this.food.track(id); }
  @HttpCode(200) @Post('orders/:id/cancel')
  cancel(@Param('id') id: string, @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>) { return this.food.cancel(id, b.reason ?? ''); }
  @HttpCode(200) @Post('orders/:id/rate')
  rate(@Param('id') id: string, @Body(new ZodPipe(Rate)) b: z.infer<typeof Rate>) { return this.food.rate(id, b); }

  // Restaurant partner
  @Get('partner/board') board(@Query('restaurantId') rid?: string) { return this.food.partnerBoard(rid); }
  @Get('partner/menu') menu(@Query('restaurantId') rid?: string) { return this.food.partnerMenu(rid); }
  @Get('partner/insights') partnerInsights(@Query('restaurantId') rid?: string) { return this.food.partnerInsights(rid); }
  @HttpCode(200) @Post('partner/orders/:id/:action')
  partnerAction(@Param('id') id: string, @Param('action') action: string, @Body(new ZodPipe(PartnerAction)) b: z.infer<typeof PartnerAction>) {
    return this.food.partnerAction(id, oneOf(action, ['accept', 'reject', 'ready'] as const), b.comment);
  }
  @Put('partner/restaurant/:id')
  restaurantPatch(@Param('id') id: string, @Body(new ZodPipe(RestaurantPatch)) b: z.infer<typeof RestaurantPatch>) { return this.data.update('restaurant', id, b); }
  @Put('partner/menu/:id')
  menuPatch(@Param('id') id: string, @Body(new ZodPipe(MenuPatch)) b: z.infer<typeof MenuPatch>) { return this.data.update('menu_item', id, b); }
  @Post('partner/menu')
  menuAdd(@Body(new ZodPipe(MenuNew)) b: z.infer<typeof MenuNew>) { return this.food.addMenuItem(b); }

  // Delivery partner
  @Get('rider/home') riderHome() { return this.food.riderHome(); }
  @Put('rider/online') riderOnline(@Body(new ZodPipe(Online)) b: z.infer<typeof Online>) { return this.food.riderOnline(b.online); }
  @HttpCode(200) @Post('rider/deliveries/:id/:action')
  riderAction(@Param('id') id: string, @Param('action') action: string) {
    return this.food.riderAction(id, oneOf(action, ['pick_up', 'deliver'] as const));
  }

  // Admin / ops
  @Get('admin/live') live() { return this.food.live(); }
  @Get('admin/insights') insights(@Query('days') days?: string) { return this.food.insights(Math.min(90, Math.max(7, Number(days) || 30))); }
}

/** NexEats food-delivery module. Depends only on core services; talks to others through events. */
@Module({
  imports: [AccessModule, AuthModule, EventsModule, MetadataModule, WorkflowModule],
  controllers: [FoodController],
  providers: [FoodService, FoodDispatchConsumer, FoodAutopilot],
})
export class FoodModule {}
