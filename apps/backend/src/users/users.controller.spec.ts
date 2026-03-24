import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUser: User = {
    id: 'test-id',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'John Doe',
    bio: 'Test user bio',
    avatarUrl: 'https://example.com/avatar.jpg',
    stellarPublicKey: 'GABC123',
    role: UserRole.USER,
    preferences: {
      notifications: {
        priceAlerts: true,
        newsAlerts: true,
        securityAlerts: true,
      },
    },
    stellarAccounts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: 'hashed-password',
  };

  beforeEach(async () => {
    const mockUsersService: Partial<UsersService> = {
      findAll: jest.fn().mockResolvedValue([mockUser]),

      findById: jest.fn().mockResolvedValue(mockUser),

      update: jest
        .fn()
        .mockImplementation((id: string, updateData: Partial<User>) => {
          return Promise.resolve({ ...mockUser, ...updateData });
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /users/me', () => {
    it('should return current user profile', async () => {
      const mockRequest = {
        user: { id: 'test-id', email: 'test@example.com' },
      } as any;

      const result = await controller.getProfile(mockRequest);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-id');
      expect(result.email).toBe('test@example.com');
      expect(result.displayName).toBe('John Doe');
      expect(result.preferences?.notifications.priceAlerts).toBe(true);
    });
  });

  describe('PATCH /users/me', () => {
    it('should update user profile', async () => {
      const mockRequest = {
        user: { id: 'test-id', email: 'test@example.com' },
      } as any;
      const updateData = {
        displayName: 'Updated Name',
        bio: 'Updated bio',
      };

      const result = await controller.updateProfile(mockRequest, updateData);

      expect(result).toBeDefined();
      expect(result.displayName).toBe('Updated Name');
      expect(result.bio).toBe('Updated bio');

      expect(service.update).toHaveBeenCalledWith('test-id', {
        displayName: 'Updated Name',
        bio: 'Updated bio',
      });
    });

    it('should not allow password updates', async () => {
      const mockRequest = {
        user: { id: 'test-id', email: 'test@example.com' },
      } as any;
      const updateData = {
        displayName: 'Updated Name',
        passwordHash: 'should-not-update',
      };

      await controller.updateProfile(mockRequest, updateData);

      expect(service.update).toHaveBeenCalledWith('test-id', {
        displayName: 'Updated Name',
      });
    });

    it('should merge notification preferences without dropping existing values', async () => {
      const mockRequest = {
        user: { id: 'test-id', email: 'test@example.com' },
      } as any;
      const updateData = {
        preferences: {
          notifications: {
            newsAlerts: false,
          },
        },
      };

      const result = await controller.updateProfile(mockRequest, updateData);

      expect(result.preferences?.notifications).toEqual({
        priceAlerts: true,
        newsAlerts: false,
        securityAlerts: true,
      });

      expect(service.update).toHaveBeenCalledWith('test-id', {
        preferences: {
          notifications: {
            priceAlerts: true,
            newsAlerts: false,
            securityAlerts: true,
          },
        },
      });
    });
  });
});
